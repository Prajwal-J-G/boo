# AWS Terraform

This Terraform root manages the AWS backend: Cognito (invited users only), JWT-protected API Gateway, Go Lambda, on-demand DynamoDB, and private encrypted S3 photo storage. It can optionally host the static frontend on private S3 + CloudFront. CloudFront is disabled by default because this AWS account previously required verification before distribution creation.

Use this Terraform root **instead of** the SAM template for one deployment. Do not apply both to the same project: each creates a separate user pool, API, table, and bucket, which would split data and add duplicate resources/costs.

The Lambda is deployed as a zip using the Go custom runtime, so Terraform deployment does not require Docker. Build the artifact before running Terraform:

```sh
./build-lambda.sh
```

## Deploy backend with Azure frontend

Prerequisites: Terraform 1.5+, AWS CLI v2, Go 1.26+, AWS IAM Identity Center SSO access, and an Azure frontend URL if using the Azure hosting option.

```sh
export AWS_PROFILE=luv-deploy
aws sso login --profile "$AWS_PROFILE"
./build-lambda.sh
terraform init

terraform plan -out=tfplan \
  -var='aws_region=ap-south-1' \
  -var='stack_name=our-always' \
  -var='enable_cloudfront=false' \
  -var='frontend_origin=https://YOUR_AZURE_STATIC_SITE_ORIGIN'

terraform apply tfplan
```

The `frontend_origin` must be the exact website origin, with no trailing slash. Terraform outputs the API URL, Cognito pool/client IDs, table, and private media bucket. Set `VITE_API_URL`, `VITE_COGNITO_USER_POOL_ID`, and `VITE_COGNITO_CLIENT_ID`, build the frontend, then upload `dist/` to Azure `$web` using the Azure guide at `../azure-web/README.md`.

Create exactly two Cognito users manually. Add only your account to the `Owners` group. Both accounts can read pages and reply; only `Owners` can add original pages/photos. The Go API independently enforces editing: owners can edit originals, while a reply author can edit their own reply.

## Deploy all AWS, including CloudFront

After AWS verifies the account for CloudFront, set `enable_cloudfront=true`. First apply with the default/local `frontend_origin`, then read `website_url` and apply again with that exact URL as `frontend_origin` so API and S3 CORS match. Upload `dist/` to `website_bucket_name`; invalidate `cloudfront_distribution_id` after updates.

## State and cleanup

Terraform state contains resource metadata. This directory uses local state by default; keep `.tfstate`, `.terraform/`, plans, and credentials private. For collaboration or CI, configure an encrypted remote backend and least-privilege IAM role first.

The DynamoDB table and media bucket use both `prevent_destroy` and DynamoDB deletion protection. Removing the stack requires intentionally removing those safeguards after exporting and verifying your data. Don’t use `terraform destroy` as casual cleanup.