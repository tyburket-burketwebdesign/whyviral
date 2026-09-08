# Email templates

Paste these into **Supabase → Authentication → Emails**. Each template maps to
one tab:

| File | Supabase template | Subject line |
|---|---|---|
| `code.html` | Magic Link | Your WhyViral sign-in code |
| `confirm.html` | Confirm signup | Confirm your WhyViral account |
| `recovery.html` | Reset password | Reset your WhyViral sign-in |

`{{ .Token }}` renders the 6-digit code and **must stay in the template**.

**Do not add `{{ .ConfirmationURL }}` back.** In Supabase the code and the magic
link are the *same* one-time token. Outlook and Gmail prefetch links to scan
them for malware, and that consumes the token — so including the link means the
code in the very same email is already dead by the time someone types it. That
is the cause of "Token has expired or is invalid" on a code you just received.
No link in the email means nothing to prefetch.

## Why they look the way they do

Table layout with inline styles, because Outlook renders email with Word's
engine and ignores most modern CSS. No images either: clients block them by
default, so the wordmark is live text that always shows.
