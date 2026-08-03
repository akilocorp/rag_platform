<!-- @language Markdown  @updated 2026-08-03  @changed New page: change password, one-time passwords, forgot password. -->

# Passwords

Three separate things live here: changing a password you know, setting one after an admin
created your account, and resetting one you've forgotten.

## Change your password

1. Click your **username** in the top-right corner.
2. Choose **Change password**.
3. Fill in **Current password**, **New password**, and **Confirm new password**.
4. Click **Save password**.

You stay signed in — you're taken back to your dashboard, not the login screen.

The new password must meet the same rule as at registration: **8+ characters with a
letter, a number, and a special character**. It also has to be genuinely new — reusing
your current one is rejected with *"Choose a password you haven't used here before"*.

## If your account came with a one-time password

When an administrator creates an account for you, no verification email is sent. Instead
they hand you a **one-time password** that looks like this:

```
wxyz-4821-QRST
```

It avoids letters that are easy to confuse when read aloud (no capital I, lowercase l,
digit 1, or O/0), and the hyphens are what satisfy the "special character" requirement.

**How it works:**

1. Sign in at `/login` with your email and that one-time password.
2. You're taken straight to **"Set your password"** — you can't go anywhere else first.
3. There's no "Current password" field here; just choose your new password twice.
4. Click **Save password**. You're now a normal account and land on your dashboard.

> **It really is one-time.** Until you set your own password, every other part of the app
> refuses to load — this is enforced on the server, not just in the browser, so opening a
> bookmark or a second tab won't get you around it. That's deliberate: it means a password
> that was read out loud or sent over chat can't keep working.

Lost the one-time password before you used it? Use **Forgot Password** below — it works
for admin-created accounts too and clears the gate at the same time.

## Forgot your password

This one works differently from most sites, so read the order carefully: **you choose the
new password first, and the emailed link confirms it.**

1. On the login page, click **"Forgot Password?"**.
2. Enter your **Email**, then the **New Password** you want, twice.
3. Click **Send Reset Link**.
4. You'll see *"Check your email"*. Open the email titled **"Actr Lab - Reset Your
   Password"** and click the link.
5. The page confirms **"Password Updated"** and sends you to the login screen.

Your password does **not** change until you click that link. Until then, your old one
still works.

> **The reset link expires after one hour.** After that you'll see *"The reset link has
> expired. Please request a new one."* — just start again from step 1.

For privacy, step 3 shows the same *"Check your email"* message whether or not the address
is registered. So if no email arrives, check your spam folder, then check you typed the
address you actually signed up with.

## Common problems

| What you see | What it means |
|---|---|
| "Your current password is required" | You left the current-password field blank on a normal change |
| "That current password is incorrect" | The current password is wrong — use Forgot Password instead |
| "Passwords do not match" | The two new-password fields differ |
| "Choose a password you haven't used here before" | Your new password is the same as the current one |
| "Password cannot be the same as old password" | Same thing, from the Forgot Password form |
