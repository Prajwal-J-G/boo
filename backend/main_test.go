package main

import (
	"testing"
	"time"
)

func TestIsOwner(t *testing.T) {
	tests := []struct {
		name  string
		claim any
		want  bool
	}{
		{name: "owner string", claim: "Owners", want: true},
		{name: "owner in comma-separated groups", claim: "Readers,Owners", want: true},
		{name: "reader only", claim: "Readers", want: false},
		{name: "case sensitive", claim: "owners", want: false},
		{name: "owner array", claim: []any{"Readers", "Owners"}, want: true},
		{name: "empty claim", claim: nil, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isOwner(test.claim); got != test.want {
				t.Errorf("isOwner(%v) = %t, want %t", test.claim, got, test.want)
			}
		})
	}
}

func TestFormatReplyDate(t *testing.T) {
	now := time.Date(2026, time.November, 7, 18, 30, 0, 0, time.FixedZone("local", 5*60*60))
	tests := []struct {
		name  string
		value string
		want  string
		valid bool
	}{
		{name: "selected date", value: "2026-03-14", want: "March 14, 2026", valid: true},
		{name: "empty uses save date", want: "November 7, 2026", valid: true},
		{name: "invalid date rejected", value: "not-a-date", valid: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := formatReplyDate(test.value, now)
			if (err == nil) != test.valid {
				t.Fatalf("formatReplyDate(%q) error = %v, valid %t", test.value, err, test.valid)
			}
			if test.valid && got != test.want {
				t.Errorf("formatReplyDate(%q) = %q, want %q", test.value, got, test.want)
			}
		})
	}
}

func TestValidEntryPermissions(t *testing.T) {
	tests := []struct {
		name  string
		entry Entry
		owner bool
		want  bool
	}{
		{name: "owner may write letter", entry: Entry{Kind: "letter", Title: "A letter", Body: "I love you", Date: "Today"}, owner: true, want: true},
		{name: "partner may reply", entry: Entry{Kind: "reply", Title: "Re: A letter", Body: "I love you too", ReplyTo: "letter-id"}, want: true},
		{name: "owner may reply", entry: Entry{Kind: "reply", Title: "Re: A letter", Body: "Always", ReplyTo: "letter-id"}, owner: true, want: true},
		{name: "partner cannot create original letter", entry: Entry{Kind: "letter", Title: "A letter", Body: "Words", Date: "Today"}, want: false},
		{name: "reply needs target", entry: Entry{Kind: "reply", Title: "A reply", Body: "Words"}, want: false},
		{name: "reply cannot attach photo", entry: Entry{Kind: "reply", Title: "A reply", Body: "Words", ReplyTo: "letter-id", ImageKey: "uploads/photo.jpg"}, want: false},
		{name: "unknown kind rejected", entry: Entry{Kind: "secret", Title: "A page", Body: "Words"}, owner: true, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := validEntry(test.entry, test.owner); got != test.want {
				t.Errorf("validEntry(%+v, %t) = %t, want %t", test.entry, test.owner, got, test.want)
			}
		})
	}
}

func TestCanEditEntry(t *testing.T) {
	tests := []struct {
		name   string
		entry  Entry
		owner  bool
		author string
		want   bool
	}{
		{name: "owner edits letter", entry: Entry{Kind: "letter"}, owner: true, want: true},
		{name: "partner cannot edit letter", entry: Entry{Kind: "letter"}, author: "partner@example.com", want: false},
		{name: "owner edits any reply", entry: Entry{Kind: "reply", Author: "partner@example.com"}, owner: true, want: true},
		{name: "reply author edits own reply", entry: Entry{Kind: "reply", Author: "partner@example.com"}, author: "partner@example.com", want: true},
		{name: "other partner cannot edit reply", entry: Entry{Kind: "reply", Author: "partner@example.com"}, author: "owner@example.com", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := canEditEntry(test.entry, test.owner, test.author); got != test.want {
				t.Errorf("canEditEntry(%+v, %t, %q) = %t, want %t", test.entry, test.owner, test.author, got, test.want)
			}
		})
	}
}
