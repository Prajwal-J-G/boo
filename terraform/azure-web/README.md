# Azure Frontend Hosting

This Terraform configuration deploys only the static React/Vite shell to Azure Storage Static Website. It does not migrate the Go API, Cognito authentication, DynamoDB content, or private photo bucket; those remain on AWS. The website shell and sign-in page are publicly reachable, while personal page data still requires a Cognito token.

## Deploy

Prerequisites: Terraform 1.5+, Azure CLI, an Azure subscription, and permission to create resource groups/storage accounts.

```sh
az login
az account set --subscription YOUR_SUBSCRIPTION_ID
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

The account name receives a random suffix because Azure storage names are globally unique. Terraform creates a StorageV2 account with the static website feature and SPA fallback to `index.html`.

## Connect the AWS API and publish the frontend

First deploy the Go API/Cognito/data resources using SAM with CloudFront disabled and this Azure endpoint as its CORS origin. From the repository root, set `AZURE_ORIGIN` from Terraform output and deploy:

```sh
cd terraform/azure-web
export AZURE_ORIGIN="$(terraform output -raw static_website_endpoint | sed 's:/*$::')"
cd ../..
sam deploy --guided --profile luv-deploy --region ap-south-1 \
  --stack-name our-always-private \
  --parameter-overrides "FrontendOrigin=$AZURE_ORIGIN" EnableCloudFront=false
```

Use the SAM outputs `ApiUrl`, `UserPoolId`, and `UserPoolClientId` to build the frontend. Upload it after setting the production Vite variables:

```sh
export VITE_API_URL="YOUR_SAM_API_URL"
export VITE_COGNITO_USER_POOL_ID="YOUR_SAM_USER_POOL_ID"
export VITE_COGNITO_CLIENT_ID="YOUR_SAM_USER_POOL_CLIENT_ID"
npm run build

AZURE_STORAGE_ACCOUNT="$(cd terraform/azure-web && terraform output -raw storage_account_name)"
az storage blob upload-batch \
  --account-name "$AZURE_STORAGE_ACCOUNT" \
  --destination '$web' \
  --source dist/ \
  --auth-mode login \
  --overwrite
```

The signed-in Azure identity needs `Storage Blob Data Contributor` on the storage account for upload. `FrontendOrigin` must exactly match the Azure static website origin so API Gateway and private S3 upload CORS accept browser requests.

To remove only the Azure frontend resources later, run `terraform destroy` from this directory. Do not run that command unless you intend to delete the frontend host.