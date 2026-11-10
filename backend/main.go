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
	SortKey   string `json:"sortKey,omitempty" dynamodbav:"SK"`
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
	case method == http.MethodPut && strings.HasPrefix(path, "/content/"):
		claims := request.RequestContext.Authorizer.JWT.Claims
		author := claims["email"]
		if author == "" {
			author = claims["username"]
		}
		return app.updateEntry(ctx, request.PathParameters["id"], request.Body, isOwner(claims["cognito:groups"]), author)
	case method == http.MethodPost && path == "/media/upload-url":
		if !isOwner(request.RequestContext.Authorizer.JWT.Claims["cognito:groups"]) {
			return response(http.StatusForbidden, map[string]string{"error": "owner access required"}), nil
		}
		return app.createUploadURL(ctx, request.Body)
	default:
		return response(http.StatusNotFound, map[string]string{"error": "not found"}), nil
	}
}

func (app *application) updateEntry(ctx context.Context, id, body string, owner bool, author string) (events.APIGatewayV2HTTPResponse, error) {
	var update struct {
		SortKey  string `json:"sortKey"`
		Title    string `json:"title"`
		Body     string `json:"body"`
		Date     string `json:"date"`
		ImageKey string `json:"imageKey"`
	}
	if err := json.Unmarshal([]byte(body), &update); err != nil || len(body) > 12000 || id == "" || update.SortKey == "" {
		return response(http.StatusBadRequest, map[string]string{"error": "invalid update"}), nil
	}
	result, err := app.dynamo.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(app.table),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: "CONTENT"},
			"SK": &types.AttributeValueMemberS{Value: update.SortKey},
		},
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		log.Printf("load entry for update: %v", err)
		return response(http.StatusInternalServerError, map[string]string{"error": "could not load page"}), nil
	}
	if len(result.Item) == 0 {
		return response(http.StatusNotFound, map[string]string{"error": "page not found"}), nil
	}
	var entry Entry
	if err := attributevalue.UnmarshalMap(result.Item, &entry); err != nil {
		return response(http.StatusInternalServerError, map[string]string{"error": "could not decode page"}), nil
	}
	if entry.ID != id {
		return response(http.StatusNotFound, map[string]string{"error": "page not found"}), nil
	}
	if !canEditEntry(entry, owner, author) {
		return response(http.StatusForbidden, map[string]string{"error": "you cannot edit this page"}), nil
	}
	if strings.TrimSpace(update.Title) == "" || len(update.Title) > 120 || strings.TrimSpace(update.Body) == "" || len(update.Body) > 5000 || len(update.Date) > 80 {
		return response(http.StatusBadRequest, map[string]string{"error": "page fields are invalid"}), nil
	}
	if entry.Kind == "reply" {
		update.Date, err = formatReplyDate(update.Date, time.Now())
		if err != nil {
			return response(http.StatusBadRequest, map[string]string{"error": "reply date must be a calendar date"}), nil
		}
	} else if strings.TrimSpace(update.Date) == "" {
		return response(http.StatusBadRequest, map[string]string{"error": "page date is required"}), nil
	}
	if update.ImageKey != "" && !strings.HasPrefix(update.ImageKey, "uploads/") {
		return response(http.StatusBadRequest, map[string]string{"error": "invalid image reference"}), nil
	}
	updated, err := app.dynamo.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(app.table),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: "CONTENT"},
			"SK": &types.AttributeValueMemberS{Value: update.SortKey},
		},
		UpdateExpression:         aws.String("SET #title = :title, #body = :body, #date = :date, ImageKey = :imageKey"),
		ExpressionAttributeNames: map[string]string{"#title": "Title", "#body": "Body", "#date": "Date"},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":title":    &types.AttributeValueMemberS{Value: strings.TrimSpace(update.Title)},
			":body":     &types.AttributeValueMemberS{Value: strings.TrimSpace(update.Body)},
			":date":     &types.AttributeValueMemberS{Value: update.Date},
			":imageKey": &types.AttributeValueMemberS{Value: update.ImageKey},
		},
		ReturnValues: types.ReturnValueAllNew,
	})
	if err != nil {
		log.Printf("update entry: %v", err)
		return response(http.StatusInternalServerError, map[string]string{"error": "could not save page"}), nil
	}
	if err := attributevalue.UnmarshalMap(updated.Attributes, &entry); err != nil {
		return response(http.StatusInternalServerError, map[string]string{"error": "could not decode saved page"}), nil
	}
	if entry.ImageKey != "" {
		image, err := app.presigner.PresignGetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(app.bucket), Key: aws.String(entry.ImageKey)}, func(options *s3.PresignOptions) { options.Expires = 10 * time.Minute })
		if err == nil {
			entry.ImageURL = image.URL
		}
	}
	return response(http.StatusOK, entry), nil
}

func canEditEntry(entry Entry, owner bool, author string) bool {
	if entry.Kind == "reply" {
		return owner || (author != "" && entry.Author == author)
	}
	return owner && (entry.Kind == "letter" || entry.Kind == "diary" || entry.Kind == "memory")
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
	entry.PK, entry.SortKey = "CONTENT", entry.CreatedAt+"#"+entry.ID
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
