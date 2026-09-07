# Email templates

Paste these into **Supabase → Authentication → Emails**. Each template maps to
one tab:

| File | Supabase template | Subject line |
|---|---|---|
| `code.html` | Magic Link | Your WhyViral sign-in code |
| `confirm.html` | Confirm signup | Confirm your WhyViral account |
| `recovery.html` | Reset password | Reset your WhyViral sign-in |

`{{ .Token }}` renders the 6-digit code and **must stay in the template** — the
app's code box cannot be completed without it. `{{ .ConfirmationURL }}` is the
one-click link, kept as a convenience for when it survives the trip.

## Why they look the way they do

Table layout with inline styles, because Outlook renders email with Word's
engine and ignores most modern CSS. No images either: clients block them by
default, so the wordmark is live text that always shows.
