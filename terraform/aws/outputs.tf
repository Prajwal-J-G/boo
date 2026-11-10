output "api_url" {
  description = "Authenticated API Gateway base URL."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "user_pool_id" {
  value = aws_cognito_user_pool.private.id
}

output "user_pool_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "owners_group_name" {
  value = aws_cognito_user_group.owners.name
}

output "media_bucket_name" {
  value = aws_s3_bucket.media.bucket
}

output "content_table_name" {
  value = aws_dynamodb_table.content.name
}

output "website_bucket_name" {
  description = "Null when enable_cloudfront is false."
  value       = var.enable_cloudfront ? aws_s3_bucket.web[0].bucket : null
}

output "website_url" {
  description = "CloudFront URL when enabled; otherwise the configured external frontend origin."
  value       = var.enable_cloudfront ? "https://${aws_cloudfront_distribution.web[0].domain_name}" : var.frontend_origin
}

output "cloudfront_distribution_id" {
  value = var.enable_cloudfront ? aws_cloudfront_distribution.web[0].id : null
}