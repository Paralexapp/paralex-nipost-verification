# Paralex Nipost Verification

Registration and verification system.

- Every user gets a unique, sequential ID: `JW26.001`, `JW26.002`, ... (never duplicated, never reused after deletion)
- Each registration stores a **Plate No.** (required), and the account stays **active for 12 months**, then becomes **inactive automatically** (status is calculated from the expiry date by the server, so no scheduled job is needed)
- QR code (contains the user's ID) is generated at registration and can be downloaded
- **Private by default**: only the **Verify status** page is public. Registering, profiles and the admin dashboard need a staff login.
- Roles: **staff** (register, view, verify, edit name/phone/plate, renew, print certificates) and **admin** (everything, including delete)
- **Edit**: fix a user's name, phone or plate. **Renew**: adds 12 months to the current expiry (or to today if already expired).
- **Certificate**: PDF for any user with company logo, details, signature space and the QR code (Users/Admin tab, profile page, or right after registering)

Stack: static frontend (`public/`) + one Netlify Function (`netlify/functions/api.js`, Express app in `lib/app.js`) + PostgreSQL.

## Deploy on Netlify (from GitHub)

1. **Database.** Create a free PostgreSQL database at [Neon](https://neon.tech) (or Supabase). Copy the connection string. If Neon offers a *pooled* connection string, use it, as it suits serverless. It must include `sslmode=require`.
2. **GitHub.** Run `npm install` once and commit the generated `package-lock.json`. Push this folder to a new GitHub repository. Do **not** commit `.env`.
3. **Netlify.** Choose *Add new site > Import an existing project*, pick your GitHub repo. The build settings are read from `netlify.toml` (publish folder `public`, functions folder `netlify/functions`), so you can leave the build command empty.
4. **Environment variables** (Site configuration > Environment variables):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | your Neon connection string |
   | `SESSION_SECRET` | a long random string (32+ characters) |
   | `ADMIN_PASSWORD` | strong password for admins |
   | `STAFF_PASSWORD` | strong password for staff (optional) |

5. **Deploy.** The tables are created automatically on the first request. Open your `*.netlify.app` URL: visitors see the public **Verify status** page and staff use **Staff login**.
6. **Custom domain (optional):** Site configuration > Domain management. HTTPS is automatic.

If the first request after deploy shows an error, open Netlify's *Logs > Functions* page: a wrong `DATABASE_URL` is the usual cause.

## Company logo on the certificate

The Paralex logo is already included (`lib/logo.js`). To replace it with another PNG or JPG:

```bash
npm run logo -- /path/to/new-logo.png
```
Commit and push, and Netlify redeploys. The wording at the bottom of the certificate, the company name and the "NIPOST VERIFICATION" line are set at the top of `lib/certificate.js`.

## After pulling this update

Run `npm install` (new packages: `pdfkit`, `qrcode`) and commit the updated `package-lock.json`. No database change is needed.

## Run locally

```bash
npm install
cp .env.example .env      # edit the values; set DATABASE_SSL=false for a local database
npm run dev               # http://localhost:3000
```

## Security notes

- Passwords are compared in constant time; sessions are signed, `httpOnly`, `SameSite=Strict` cookies (8 hours), `Secure` in production.
- Login (10 attempts / 15 min per IP) and verification (60 / min per IP) are rate-limited using a database table, so the limits hold across serverless instances. Security headers and a strict Content-Security-Policy are set.
- The public verify endpoint returns only name, plate, ID and dates. IDs are sequential, so anyone can try numbers one by one; this is inherent to the ID format.
- Back up your database regularly and keep `.env` secret. Rotate passwords if staff leave.

## API

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/verify/:id` | Public |
| POST | `/api/login`, `/api/logout` | Public |
| GET | `/api/me` | Public |
| POST | `/api/users` | Staff |
| GET | `/api/users` | Staff |
| PATCH | `/api/users/:id` | Staff |
| POST | `/api/users/:id/renew` | Staff |
| GET | `/api/users/:id/certificate` | Staff |
| DELETE | `/api/users/:id` | Admin |
