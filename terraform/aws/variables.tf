variable "aws_region" {
  description = "AWS region for the API, Cognito, table, and photo bucket."
  type        = string
  default     = "ap-south-1"
}

variable "stack_name" {
  description = "Prefix for names created by this Terraform root."
  type        = string
  default     = "our-always"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,24}$", var.stack_name))
    error_message = "stack_name must be 3 to 25 lowercase letters, digits, or hyphens, beginning with a letter."
  }
}

variable "frontend_origin" {
  description = "Exact browser origin allowed by API and photo upload CORS, without a trailing slash."
  type        = string
  default     = "http://localhost:5173"

  validation {
    condition     = can(regex("^https?://[^/]+$", var.frontend_origin))
    error_message = "frontend_origin must be an origin such as https://example.web.core.windows.net, without a path or trailing slash."
  }
}

variable "enable_cloudfront" {
  description = "Create an AWS-hosted static site on a private S3 origin. Requires AWS account verification for CloudFront."
  type        = bool
  default     = false
}

variable "lambda_zip_path" {
  description = "Path to the zip produced by build-lambda.sh."
  type        = string
  default     = "build/lambda.zip"
}