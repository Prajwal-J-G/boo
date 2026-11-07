# our, always

A private, photo-led archive of love letters, diary confessions, and shared memories. The React app shell is static on CloudFront; personal content is behind Cognito authentication. Uploaded photos stay in a private S3 bucket and are delivered with short-lived presigned URLs.

## Local preview

```sh
npm install
npm run dev
```

Local development uses sample copy and stock-photo placeholders so the design can be explored without AWS credentials. Notes added in preview are held in memory for that browser session only. Production requires Cognito and API settings; without them, the app shows the sign-in screen.

## Stack and permissions

- React, TypeScript, Vite, Motion, and Lucide
- Go Lambda on `provided.al2023`, behind API Gateway HTTP API JWT authorization
- Cognito user pool with self-registration disabled; create the two accounts manually
- DynamoDB on-demand table for entries, with point-in-time recovery
- Private, encrypted S3 bucket for optimized photos; uploads use short-lived presigned URLs
- Private S3 website bucket behind CloudFront Origin Access Control
- AWS SAM template in `template.yaml`

Either invited account can read letters and write a dated reply to a letter. Replies are linked to their original letter and attributed to the authenticated Cognito account. Only the `Owners` group can add original letters, diary entries, memories, or photos. Add your account to `Owners`; leave your partner’s account out of it. API Gateway verifies Cognito JWTs, and the Go handler enforces owner permissions for original entries and uploads.

## Deploy to AWS

Prerequisites: an AWS account, AWS CLI v2 configured with deployment permissions, AWS SAM CLI, Node.js 20.19+ (or 22.12+), and Go 1.24+.

1. Build and deploy the infrastructure:

   ```sh
   sam build --template-file template.yaml
   sam deploy --guided
   ```

   Choose a stack name and region, allow SAM to create IAM roles, and keep the initial `FrontendOrigin` at its default for this first deployment.

2. Read the stack outputs (`ApiUrl`, `UserPoolId`, `UserPoolClientId`, `WebBucketName`, `WebsiteUrl`, and `WebDistributionId`) in CloudFormation or with `aws cloudformation describe-stacks`.

3. Update `FrontendOrigin` to the exact `WebsiteUrl` origin, without a trailing slash. This updates API Gateway and private-photo-bucket CORS:

   ```sh
   sam deploy --parameter-overrides FrontendOrigin=https://YOUR_CLOUDFRONT_DOMAIN
   ```

4. Copy `.env.example` to `.env.production.local` and fill in the stack outputs. Build and publish the static app:

   ```sh
   npm run build
   aws s3 sync dist/ s3://YOUR_WEB_BUCKET --delete
   aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths '/*'
   ```

5. In Cognito, create exactly two users with **Create user** (self-registration is disabled). Add your account to the `Owners` group; leave your partner’s account out of that group. Use temporary passwords and change them at first sign-in.

The photo bucket and content table have `Retain` deletion policies. Personal photos and letters never go in the static-site bucket. CloudFront serves the app shell; API access requires a Cognito token.

## Content API

- `GET /content` returns entries and 10-minute signed photo URLs to either authenticated user.
- `POST /content` stores a love letter, diary entry, photo memory, or linked reply. Original entries require `Owners`; replies are available to both invited accounts.
- `POST /media/upload-url` issues a five-minute S3 upload URL. `Owners` group required.

Replies can be assigned a calendar date in the notebook; if omitted, the API uses the save date. Photos are resized to at most 2,000 pixels and JPEG quality 84 in the browser before upload. The original chosen file must be 10 MB or smaller.

## CI/CD and containers

GitHub Actions runs Oxlint, the responsive Playwright suite, the frontend production build, Go tests, SAM validation/build, and the frontend image build on pushes and pull requests. The deploy workflow runs on pushes to `main` and can also be started manually. It deploys the SAM stack and Go Lambda image, configures the CloudFront URL as the API/S3 CORS origin, builds the frontend with the stack outputs, syncs it to the private site bucket, and invalidates CloudFront.

For GitHub deployment, configure repository variable `AWS_REGION` and secret `AWS_DEPLOY_ROLE_ARN`. The role must trust GitHub Actions OIDC for this repository and permit the stack’s CloudFormation/SAM, S3 artifact, ECR image, Lambda, Cognito, DynamoDB, API Gateway, CloudFront, and IAM operations. No AWS keys should be stored in GitHub secrets. The workflow currently uses the fixed stack name `our-always-private`.

`backend/Dockerfile` packages the Go Lambda custom runtime as an AWS Lambda image. `Dockerfile.frontend` builds the static site into an Nginx image for optional local/container hosting; the AWS production frontend remains S3 + CloudFront for lower idle cost. To build the web image with production config, pass the `VITE_API_URL`, `VITE_COGNITO_USER_POOL_ID`, and `VITE_COGNITO_CLIENT_ID` build arguments. These are public client configuration values, not secrets.

The repository currently has no Git remote and the configured AWS credentials must be repaired before a cloud deployment can succeed. After initializing/pushing the repository and configuring the OIDC role, the workflow can deploy automatically from `main`.