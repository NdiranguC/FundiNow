# FundiNow

FundiNow connects customers in Kenya with local, verified fundis. The app uses
Supabase for authentication, PostgreSQL, row-level security, file storage, and
realtime job updates. M-Pesa, card, and cash payments remain unavailable until a
payment provider is integrated; jobs stay unpaid and payment controls are
disabled in the meantime.

## Local demo

Requirements: Node.js with npm, Docker Desktop, and the Supabase CLI.

1. Copy `.env.example` to `.env`.
2. Start the local Supabase stack:

   ```sh
   supabase start
   ```

3. Copy the local API URL and publishable key from `supabase status` into
   `VITE_SUPABASE_URL`, `SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and
   `SUPABASE_PUBLISHABLE_KEY` in `.env`.
4. Install dependencies and start FundiNow:

   ```sh
   npm install
   npm run dev
   ```

5. Register with email and password as a customer or fundi. The account using
   `charlesmutuan@gmail.com` is the sole administrator; the database assigns
   that role automatically and rejects admin roles for other email addresses.
   Local email confirmations are disabled. To test fundi matching, register
   fundis and verify them from the admin dashboard.

Local app: `http://localhost:5173`  
Local Supabase Studio: `http://127.0.0.1:54323`

Maps and Places search require Google Maps Platform keys. They are optional for
the local demo; browser geolocation and a manually entered address can be used
without them.

In Windows PowerShell, use `npm.cmd` and `supabase.cmd` if script execution
policy blocks the `.ps1` command shims.

## Fresh hosted Supabase project

1. Create a new Supabase project.
2. Set the project URL and publishable key in the app's environment. The app
   uses row-level security and does not require a service-role key.
3. Link the CLI and apply the checked-in migrations:

   ```sh
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

4. Configure the project's Auth redirect URLs for the deployed app and enable
   Google OAuth in Supabase if Google sign-in is needed.
5. Optionally configure `GOOGLE_MAPS_API_KEY` on the server and
   `VITE_GOOGLE_MAPS_API_KEY` in the browser environment. Restrict the browser
   key by referrer and API; restrict the server key to Places and Geocoding.

Email/password registration, sign-in, and email-verified password recovery are available at `/auth`.
Add each deployed app origin (including `/auth?flow=recovery`) to the Supabase
Auth redirect URL allowlist and configure Supabase Auth SMTP delivery for reset
emails. Password recovery is blocked for administrator accounts in both the
app and the database.
The
allowlisted administrator can register there too; if that account already
exists when the single-admin migration is applied, it is promoted automatically.
All other signups receive only the customer or artisan role they select.

Admin creation is restricted by database triggers and a unique constraint;
the browser cannot grant admin privileges. Use the admin dashboard to review
and verify fundi profiles.

## Database changes

Supabase migrations live in `supabase/migrations/`. For a local reset:

```sh
supabase db reset
```

Run tests and a production build before deployment:

```sh
npm run test
npm run build
```

## Current limitations

- Payments are not processed. Payment options remain pending and cannot mark a
  job paid.
- Maps, address autocomplete, and reverse geocoding require Google Maps API
  credentials. Manual addresses and browser location remain available without
  those integrations.
- Job lifecycle notifications are available in-app while users are signed in.
  Email and push delivery still require an owned sender domain and notification
  provider credentials.
- New jobs use customer-approved, versioned itemized fundi quotes before work
  can start. Customers and fundis can keep private progress/evidence updates,
  record snags and their resolutions, and confirm handover. Approved quote
  versions can be downloaded as a PDF agreement summary; the PDF is not legal
  advice or proof of payment. Existing jobs retain their original quote
  requirements.
- Job agreement drafts stay in the current page while offline and can be
  retried after reconnecting. Do not close or refresh the page before sending
  an offline draft.
- Frequently viewed data is briefly cached and refreshed from realtime job,
  chat, and notification events; stale queries refresh when the app reconnects
  or returns to the foreground. Job evidence views load the 100 latest updates.
