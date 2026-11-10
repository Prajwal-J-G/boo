data "aws_partition" "current" {}

locals {
  name               = var.stack_name
  lambda_zip         = abspath("${path.module}/${var.lambda_zip_path}")
  cloudfront_enabled = var.enable_cloudfront
}

resource "aws_cognito_user_pool" "private" {
  name                     = "${local.name}-private"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  schema {
    attribute_data_type = "String"
    name                = "email"
    mutable             = true
    required            = true
  }

  tags = { Application = local.name }
}

resource "aws_cognito_user_pool_client" "web" {
  name                          = "${local.name}-web"
  user_pool_id                  = aws_cognito_user_pool.private.id
  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_USER_SRP_AUTH", "ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  access_token_validity         = 60
  id_token_validity             = 60
  refresh_token_validity        = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_group" "owners" {
  name         = "Owners"
  description  = "May create original pages and upload photos."
  user_pool_id = aws_cognito_user_pool.private.id
}

resource "aws_dynamodb_table" "content" {
  name         = "${local.name}-content"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  server_side_encryption { enabled = true }
  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = true

  tags = {
    Application = local.name
    Data        = "private-user-content"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket" "media" {
  bucket_prefix = "${local.name}-media-"

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Application = local.name
    Data        = "private-user-photos"
  }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = [var.frontend_origin]
    max_age_seconds = 3600
  }
}

resource "aws_iam_role" "lambda" {
  name = "${local.name}-api-lambda"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_data" {
  name = "${local.name}-data-access"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.content.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "${aws_s3_bucket.media.arn}/*"
      }
    ]
  })
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name}-api"
  role             = aws_iam_role.lambda.arn
  package_type     = "Zip"
  runtime          = "provided.al2023"
  handler          = "bootstrap"
  filename         = local.lambda_zip
  source_code_hash = filebase64sha256(local.lambda_zip)
  architectures    = ["x86_64"]
  timeout          = 15
  memory_size      = 256

  environment {
    variables = {
      CONTENT_TABLE = aws_dynamodb_table.content.name
      MEDIA_BUCKET  = aws_s3_bucket.media.bucket
    }
  }

  depends_on = [aws_iam_role_policy_attachment.lambda_logs, aws_iam_role_policy.lambda_data]
}

resource "aws_apigatewayv2_api" "http" {
  name          = "${local.name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [var.frontend_origin]
    allow_headers = ["authorization", "content-type"]
    allow_methods = ["GET", "POST", "PUT", "OPTIONS"]
    max_age       = 600
  }
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.http.id
  name             = "${local.name}-cognito-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.private.id}"
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

locals {
  authenticated_routes = {
    list_content   = "GET /content"
    create_content = "POST /content"
    update_content = "PUT /content/{id}"
    upload_url     = "POST /media/upload-url"
  }
}

resource "aws_apigatewayv2_route" "authenticated" {
  for_each = local.authenticated_routes

  api_id             = aws_apigatewayv2_api.http.id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

resource "aws_s3_bucket" "web" {
  count         = local.cloudfront_enabled ? 1 : 0
  bucket_prefix = "${local.name}-web-"
}

resource "aws_s3_bucket_public_access_block" "web" {
  count                   = local.cloudfront_enabled ? 1 : 0
  bucket                  = aws_s3_bucket.web[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  count  = local.cloudfront_enabled ? 1 : 0
  bucket = aws_s3_bucket.web[0].id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_cloudfront_origin_access_control" "web" {
  count                             = local.cloudfront_enabled ? 1 : 0
  name                              = "${local.name}-web-oac"
  description                       = "Private S3 origin for the static frontend"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "spa_rewrite" {
  count   = local.cloudfront_enabled ? 1 : 0
  name    = "${local.name}-spa-rewrite"
  runtime = "cloudfront-js-1.0"
  publish = true
  code    = "function handler(event) { var request = event.request; if (request.uri.indexOf('.') === -1) { request.uri = '/index.html'; } return request; }"
}

resource "aws_cloudfront_distribution" "web" {
  count               = local.cloudfront_enabled ? 1 : 0
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.web[0].bucket_regional_domain_name
    origin_id                = "private-site-bucket"
    origin_access_control_id = aws_cloudfront_origin_access_control.web[0].id
  }

  default_cache_behavior {
    target_origin_id       = "private-site-bucket"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6"

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite[0].arn
    }
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate { cloudfront_default_certificate = true }
  tags = { Application = local.name }
}

resource "aws_s3_bucket_policy" "web" {
  count  = local.cloudfront_enabled ? 1 : 0
  bucket = aws_s3_bucket.web[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.web[0].arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.web[0].arn } }
    }]
  })
}