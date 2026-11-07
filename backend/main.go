package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Entry struct {
	ID        string `json:"id" dynamodbav:"ID"`
	Kind      string `json:"kind" dynamodbav:"Kind"`
	Title     string `json:"title" dynamodbav:"Title"`
	Body      string `json:"body" dynamodbav:"Body"`
	Date      string `json:"date" dynamodbav:"Date"`
	ImageKey  string `json:"imageKey,omitempty" dynamodbav:"ImageKey,omitempty"`
	ImageURL  string `json:"imageUrl,omitempty" dynamodbav:"-"`
	ReplyTo   string `json:"replyTo,omitempty" dynamodbav:"ReplyTo,omitempty"`
	Author    string `json:"author,omitempty" dynamodbav:"Author,omitempty"`
	CreatedAt string `json:"-" dynamodbav:"CreatedAt"`
	PK        string `json:"-" dynamodbav:"PK"`
	SK        string `json:"-" dynamodbav:"SK"`
}

type application struct {
	table     string
	bucket    string
	dynamo    *dynamodb.Client
	s3        *s3.Client
	presigner *s3.PresignClient
}

func main() {
	ctx := context.Background()
	awsConfig, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		log.Fatal(err)
	}
	store := &application{
		table: os.Getenv("CONTENT_TABLE"), bucket: os.Getenv("MEDIA_BUCKET"),
		dynamo: dynamodb.NewFromConfig(awsConfig), s3: s3.NewFromConfig(awsConfig),
		presigner: s3.NewPresignClient(s3.NewFromConfig(awsConfig)),
	}
	lambda.Start(store.handle)
}

func (app *application) handle(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	method, path := request.RequestContext.HTTP.Method, request.RawPath
	switch {
	case method == http.MethodGet && path == "/content":
		return app.listEntries(ctx)
	case method == http.MethodPost && path == "/content":
		claims := request.RequestContext.Authorizer.JWT.Claims
		author := claims["email"]
		if author == "" {
			author = claims["username"]
		}
		return app.createEntry(ctx, request.Body, isOwner(claims["cognito:groups"]), author)
	case method == http.MethodPost && path == "/media/upload-url":
		if !isOwner(request.RequestContext.Authorizer.JWT.Claims["cognito:groups"]) {
			return response(http.StatusForbidden, map[string]string{"error": "owner access required"}), nil
		}
		return app.createUploadURL(ctx, request.Body)
	default:
		return response(http.StatusNotFound, map[string]string{"error": "not found"}), nil
	}
}

func (app *application) listEntries(ctx context.Context) (events.APIGatewayV2HTTPResponse, error) {
	result, err := app.dynamo.Query(ctx, &dynamodb.QueryInput{
		TableName: aws.String(app.table), KeyConditionExpression: aws.String("PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":pk": &types.AttributeValueMemberS{Value: "CONTENT"}},
		ScanIndexForward:          aws.Bool(false), Limit: aws.Int32(100),
	})
	if err != nil {
		log.Printf("query content: %v", err)
		return response(http.StatusInternalServerError, map[string]string{"error": "could not load entries"}), nil
	}
	entries := make([]Entry, 0, len(result.Items))
	for _, item := range result.Items {
		var entry Entry
		if err := attributevalue.UnmarshalMap(item, &entry); err != nil {
			log.Printf("decode entry: %v", err)
			continue
		}
		if entry.ImageKey != "" {
			image, err := app.presigner.PresignGetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(app.bucket), Key: aws.String(entry.ImageKey)}, func(options *s3.PresignOptions) { options.Expires = 10 * time.Minute })
			if err == nil {
				entry.ImageURL = image.URL
			}
		}
		entries = append(entries, entry)
	}
	return response(http.StatusOK, map[string]any{"entries": entries}), nil
}

func (app *application) createEntry(ctx context.Context, body string, owner bool, author string) (events.APIGatewayV2HTTPResponse, error) {
	var entry Entry
	if err := json.Unmarshal([]byte(body), &entry); err != nil || len(body) > 12000 {
		return response(http.StatusBadRequest, map[string]string{"error": "invalid entry"}), nil
	}
	if !validEntry(entry, owner) {
		if entry.Kind != "reply" && !owner {
			return response(http.StatusForbidden, map[string]string{"error": "owner access required for original entries"}), nil
		}
		return response(http.StatusBadRequest, map[string]string{"error": "entry fields are invalid"}), nil
	}
	if entry.Kind == "reply" {
		formattedDate, err := formatReplyDate(entry.Date, time.Now())
		if err != nil {
			return response(http.StatusBadRequest, map[string]string{"error": "reply date must be a calendar date"}), nil
		}
		entry.Date = formattedDate
		if author == "" {
			author = "A private note"
		}
		entry.Author = author
		entry.ImageKey = ""
	}
	if entry.ImageKey != "" && !strings.HasPrefix(entry.ImageKey, "uploads/") {
		return response(http.StatusBadRequest, map[string]string{"error": "invalid image reference"}), nil
	}
	id, err := randomID()
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, err
	}
	entry.ID = id
	entry.CreatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	entry.PK, entry.SK = "CONTENT", entry.CreatedAt+"#"+entry.ID
	item, err := attributevalue.MarshalMap(entry)
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, err
	}
	if _, err = app.dynamo.PutItem(ctx, &dynamodb.PutItemInput{TableName: aws.String(app.table), Item: item}); err != nil {
		log.Printf("save entry: %v", err)
		return response(http.StatusInternalServerError, map[string]string{"error": "could not save entry"}), nil
	}
	if entry.ImageKey != "" {
		image, err := app.presigner.PresignGetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(app.bucket), Key: aws.String(entry.ImageKey)}, func(options *s3.PresignOptions) { options.Expires = 10 * time.Minute })
		if err == nil {
			entry.ImageURL = image.URL
		}
	}
	return response(http.StatusCreated, entry), nil
}

func formatReplyDate(value string, now time.Time) (string, error) {
	if value == "" {
		return now.UTC().Format("January 2, 2006"), nil
	}
	date, err := time.Parse("2006-01-02", value)
	if err != nil {
		return "", err
	}
	return date.UTC().Format("January 2, 2006"), nil
}

func validEntry(entry Entry, owner bool) bool {
	if strings.TrimSpace(entry.Title) == "" || len(entry.Title) > 120 || strings.TrimSpace(entry.Body) == "" || len(entry.Body) > 5000 || len(entry.Date) > 80 {
		return false
	}
	switch entry.Kind {
	case "reply":
		return strings.TrimSpace(entry.ReplyTo) != "" && len(entry.ReplyTo) <= 64 && entry.ImageKey == ""
	case "letter", "diary", "memory":
		return owner && strings.TrimSpace(entry.Date) != ""
	default:
		return false
	}
}

func (app *application) createUploadURL(ctx context.Context, body string) (events.APIGatewayV2HTTPResponse, error) {
	var input struct {
		ContentType string `json:"contentType"`
	}
	if err := json.Unmarshal([]byte(body), &input); err != nil {
		return response(http.StatusBadRequest, map[string]string{"error": "invalid upload request"}), nil
	}
	extensions := map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
	extension, ok := extensions[input.ContentType]
	if !ok {
		return response(http.StatusBadRequest, map[string]string{"error": "unsupported image type"}), nil
	}
	id, err := randomID()
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, err
	}
	key := "uploads/" + id + extension
	result, err := app.presigner.PresignPutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(app.bucket), Key: aws.String(key), ContentType: aws.String(input.ContentType)}, func(options *s3.PresignOptions) { options.Expires = 5 * time.Minute })
	if err != nil {
		log.Printf("presign upload: %v", err)
		return response(http.StatusInternalServerError, map[string]string{"error": "could not authorize photo upload"}), nil
	}
	return response(http.StatusOK, map[string]string{"uploadUrl": result.URL, "imageKey": key}), nil
}

func isOwner(value any) bool {
	switch groups := value.(type) {
	case string:
		for _, group := range strings.Split(groups, ",") {
			if strings.TrimSpace(group) == "Owners" {
				return true
			}
		}
	case []any:
		for _, group := range groups {
			if name, ok := group.(string); ok && name == "Owners" {
				return true
			}
		}
	case []string:
		for _, group := range groups {
			if group == "Owners" {
				return true
			}
		}
	}
	return false
}

func response(status int, value any) events.APIGatewayV2HTTPResponse {
	body, err := json.Marshal(value)
	if err != nil {
		body = []byte(`{"error":"response encoding failed"}`)
		status = http.StatusInternalServerError
	}
	return events.APIGatewayV2HTTPResponse{StatusCode: status, Headers: map[string]string{"content-type": "application/json; charset=utf-8", "cache-control": "no-store"}, Body: string(body)}
}

func randomID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", fmt.Errorf("generate id: %w", err)
	}
	return hex.EncodeToString(bytes[:]), nil
}
