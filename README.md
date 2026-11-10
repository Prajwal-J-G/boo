# our, always

A private, photo-led archive of love letters, diary confessions, and shared memories. The React app shell is static on CloudFront; personal content is behind Cognito authentication. Uploaded photos stay in a private S3 bucket and are delivered with short-lived presigned URLs.

## Local preview

```sh
./scripts/run-local.sh
```

Open the URL Vite prints, usually `http://127.0.0.1:5173/`. The script checks Node/npm, installs locked dependencies if needed, and binds to loopback so the preview is reachable only from this computer. Local development uses sample copy and stock-photo placeholders; notes added in preview are held in memory for that browser session only. Production requires Cognito and API settings; without them, the app shows the sign-in screen.

### Local container

With Docker or Podman installed, run:

```sh
./scripts/run-container.sh
```

It builds the Vite development image and publishes only to `127.0.0.1:5173`. Press Ctrl+C to stop it. To use Compose with live source mounts instead:

```sh
docker compose up --build
```

## GitHub Pages

GitHub Pages can host only the frontend shell. It does not make the site itself private: the login screen and JavaScript bundle are publicly reachable. With Cognito enabled, letters and photos remain protected by the authenticated API and private S3 URLs, but the public shell may not match the desired private-by-invitation feel. Hosting on Pages also needs a Vite base path for the repository URL and an AWS API/S3 CORS origin update. For this project, the planned S3 + CloudFront host is the better fit; personal content remains in authenticated services either way.

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

## Deploy AWS with Terraform

An alternative to SAM is in `terraform/aws/`. It provisions the Go API, Cognito pool/client/Owners group, DynamoDB content table, and private photo bucket. CloudFront is optional and defaults off, which is useful while AWS account verification is pending or when using the Azure frontend below.

Build the Lambda zip, then plan and apply the AWS backend. For Azure hosting, replace the example origin with the exact Azure Static Website origin:

```sh
export AWS_PROFILE=luv-deploy
aws sso login --profile "$AWS_PROFILE"
./terraform/aws/build-lambda.sh
cd terraform/aws
terraform init
terraform plan -out=tfplan \
   -var='aws_region=ap-south-1' \
   -var='stack_name=our-always' \
   -var='enable_cloudfront=false' \
   -var='frontend_origin=http://localhost:5173'
terraform apply tfplan
```

Terraform outputs the API URL, Cognito IDs, table, and bucket. Use the outputs for the production Vite variables before building the frontend. The table and photo bucket have destroy protection; Terraform state and plan files are local deployment metadata and are ignored by Git.

After AWS verifies CloudFront, opt into AWS-hosted frontend delivery with `-var='enable_cloudfront=true'`. Apply once, set `frontend_origin` to the resulting `website_url`, then apply again so API and S3 CORS allow that origin. Upload the frontend build to `website_bucket_name` and invalidate the distribution after updates.

## Deploy frontend to Azure

This is a cross-cloud option: Terraform hosts the static frontend on Azure Storage Static Website, while Go API, Cognito, DynamoDB, and private photos remain on AWS. The frontend shell is public; personal content still requires Cognito authentication. Azure deployment does not migrate the backend.

The AWS template’s `EnableCloudFront` parameter defaults to `true`. For Azure hosting set it to `false`; this avoids creating a CloudFront distribution while the AWS account is awaiting CloudFront verification. Terraform creates Azure resources, while SAM creates the AWS backend:

1. Install Terraform 1.5+ and Azure CLI, sign in, and select your subscription:

   ```sh
   az login
   az account set --subscription YOUR_SUBSCRIPTION_ID
   cd terraform/azure-web
   terraform init
   terraform plan
   terraform apply
   ```

2. Capture the Azure website origin, then return to the repository root:

   ```sh
   export AZURE_ORIGIN="$(terraform output -raw static_website_endpoint | sed 's:/*$::')"
   cd ../..
   ```

3. The earlier failed SAM attempt may have left an ignored local `samconfig.toml` with the old `mylady` stack and ECR repository. Back it up before the first correctly named deployment so SAM won’t reuse those stale values:

   ```sh
   [[ ! -f samconfig.toml ]] || mv samconfig.toml samconfig.mylady-backup.toml
   sam build --template-file template.yaml
   sam deploy --guided --profile luv-deploy --region ap-south-1 \
     --stack-name our-always-private \
     --parameter-overrides "FrontendOrigin=$AZURE_ORIGIN" EnableCloudFront=false
   ```

   Confirm the CloudFormation changeset when prompted. The Go Lambda/API and private data services will be created in AWS; AWS CloudFront will not.

4. Build the production frontend using the API/Cognito outputs from the `our-always-private` stack and upload it to Azure:

   ```sh
   export VITE_API_URL="$(aws cloudformation describe-stacks --stack-name our-always-private --region ap-south-1 --profile luv-deploy --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue | [0]" --output text)"
   export VITE_COGNITO_USER_POOL_ID="$(aws cloudformation describe-stacks --stack-name our-always-private --region ap-south-1 --profile luv-deploy --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue | [0]" --output text)"
   export VITE_COGNITO_CLIENT_ID="$(aws cloudformation describe-stacks --stack-name our-always-private --region ap-south-1 --profile luv-deploy --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue | [0]" --output text)"
   npm run build

   export AZURE_STORAGE_ACCOUNT="$(terraform -chdir=terraform/azure-web output -raw storage_account_name)"
   az storage blob upload-batch --account-name "$AZURE_STORAGE_ACCOUNT" \
     --destination '$web' --source dist/ --auth-mode login --overwrite
   ```

   The signed-in Azure user needs `Storage Blob Data Contributor` on the storage account. Terraform state is local by default; keep it private and configure remote state before sharing the deployment with others.

## Content API

- `GET /content` returns entries and 10-minute signed photo URLs to either authenticated user.
- `POST /content` stores a love letter, diary entry, photo memory, or linked reply. Original entries require `Owners`; replies are available to both invited accounts.
- `POST /media/upload-url` issues a five-minute S3 upload URL. `Owners` group required.

Replies can be assigned a calendar date in the notebook; if omitted, the API uses the save date. Photos are resized to at most 2,000 pixels and JPEG quality 84 in the browser before upload. The original chosen file must be 10 MB or smaller.

## CI/CD and containers

GitHub Actions runs Oxlint, the responsive Playwright suite, the frontend production build, Go tests, SAM validation/build, and the frontend image build on pushes and pull requests. The deploy workflow runs on pushes to `main` and can also be started manually. It deploys the SAM stack and Go Lambda image, configures the CloudFront URL as the API/S3 CORS origin, builds the frontend with the stack outputs, syncs it to the private site bucket, and invalidates CloudFront.

For GitHub deployment, configure repository variable `AWS_REGION` and secret `AWS_DEPLOY_ROLE_ARN`. The role must trust GitHub Actions OIDC for this repository and permit the stack’s CloudFormation/SAM, S3 artifact, ECR image, Lambda, Cognito, DynamoDB, API Gateway, CloudFront, and IAM operations. No AWS keys should be stored in GitHub secrets. The workflow currently uses the fixed stack name `our-always-private`.

`backend/Dockerfile` packages the Go Lambda custom runtime as an AWS Lambda image. `Dockerfile.frontend` builds the static site into an Nginx image for optional hosting. The local demo uses `Dockerfile.dev` through Compose or `scripts/run-container.sh`.

The AWS account currently requires verification before creating CloudFront distributions. Use `EnableCloudFront=false` for the Azure-hosted frontend path while that is pending. The repository has no Git remote configured, so GitHub Actions deployment requires adding a remote and configuring its OIDC role first.