# ADR 0001: Where to store customer-uploaded photos

**Status:** Accepted (implemented)
**Date:** 2026-10-01
**Deciders:** Site owner, engineering

## Context

Customers can optionally attach a photo when they book (a look they like, or a
photo of their skin tone) so Mercy can prepare. We need somewhere to keep it.

What constrains the choice:

- **The app runs on Render, whose disk is ephemeral.** Anything written to the
  server's filesystem is wiped on every deploy and restart, so "save it to a
  folder" silently loses photos.
- **MongoDB Atlas is already the system of record** for bookings, with
  backups and an in-memory fallback for local development. Adding a second
  storage service means another account, another secret, and another thing to
  secure and pay for.
- **Photos are personal data.** A face photo is sensitive. It must never be
  publicly reachable, should be kept no longer than needed, and should not leak
  location metadata (phones embed GPS coordinates in photos).
- **Scale is small.** A solo makeup artist: tens of bookings a month, and only
  some with a photo.
- **Customers book without an account.** The only thing tying an upload to a
  booking is the per-booking `receiptToken` they already receive.

## Decision

Store each photo **in MongoDB, in its own collection (`bookingphotos`), as binary
data, behind a small storage interface** (`photoStore.put / get / delete`).

- The browser resizes the photo to at most 1200px and re-encodes it as JPEG
  before upload. That keeps files around 200-500 KB and strips EXIF/GPS data.
- The server independently enforces a 3 MB cap, an allow-list of types (JPEG,
  PNG, WebP), and checks the file's real signature rather than trusting the
  declared type.
- One photo per booking; uploading again replaces it.
- Uploading requires the booking's `receiptToken` (or an admin login). Viewing is
  admin-only: images are never served from a public URL.
- A TTL index deletes each photo 90 days after upload, and deleting a booking
  deletes its photo.
- The photo lives in a separate collection from the booking, so booking lists and
  dashboards never load image bytes. The booking only carries a `hasPhoto` flag.

## Options considered

### A. MongoDB binary documents (chosen)

| Dimension | Assessment |
|---|---|
| Complexity | Low: no new service, no new secret |
| Cost | Free within the Atlas free tier (512 MB) |
| Scalability | Fine for hundreds to low thousands of photos |
| Durability | Included in the existing database backups |
| Privacy/retention | TTL index gives automatic expiry; delete is one query |
| Team familiarity | Same tools already used for everything else |

**Pros:** simplest thing that works on ephemeral hosting; one place to back up,
secure, and expire; transactional with the booking lifecycle.
**Cons:** photos count against database storage and RAM-bound working set; not
how you would build a photo-heavy product; every view streams bytes through the
Node process.

### B. Local disk (`/uploads` folder)

**Rejected.** Render's disk is wiped on deploy/restart, so photos would vanish.
Persistent disks exist but are paid, single-instance, and complicate scaling and
backups.

### C. Object storage (Amazon S3, Cloudflare R2, Cloudinary)

| Dimension | Assessment |
|---|---|
| Complexity | Medium: new account, credentials, SDK, signed URLs, CORS |
| Cost | Pennies at this scale, but another bill and another vendor |
| Scalability | Effectively unlimited; browser can upload directly |
| Durability | Excellent, separate lifecycle rules for expiry |
| Privacy | Needs private buckets and short-lived signed URLs done correctly |

**Pros:** the right long-term home for images; keeps the database small; CDN and
lifecycle rules built in.
**Cons:** more moving parts and more ways to misconfigure a bucket into a public
one; overkill for this volume today.
**Not chosen now, but the door is open:** see "Migration path".

### D. Base64 inside the booking document

**Rejected.** Inflates every booking read by ~33% of the image size, so the admin
list, dashboard and exports would drag image bytes around, and a large image
risks Mongo's 16 MB document limit.

### E. Email the photo to Mercy

**Rejected.** Photo ends up in an inbox with no expiry, no link to the booking,
and no control over who else can see it.

## Trade-off analysis

The deciding factors were *operational simplicity* and *privacy control* over raw
scalability. At this volume the extra capability of object storage is unused,
while its extra surface area (buckets, keys, signed URLs) is real risk for
sensitive images. Keeping photos in the database we already secure, back up and
expire is the lower-risk option. The cost is that the database carries the bytes;
the client-side resize, the 3 MB cap and the 90-day expiry keep that bounded.

Rough capacity: at ~400 KB each, 500 MB of Atlas free tier holds well over a
thousand photos, and expiry means the live set stays far smaller.

## Consequences

**Easier:** one backup, one retention policy, one thing to secure; deleting a
customer's data deletes their photo too; works identically in local development
(an in-memory store is used when no database is configured).

**Harder:** large volumes of photos would bloat the database; viewing a photo
streams through the app server.

**Revisit when:** photos are routinely requested on most bookings, the database
nears its storage limit, or Mercy wants galleries/before-and-after sets (a
different feature with different needs).

## Migration path to object storage

All access goes through `photoStore`. To move to S3/R2:

1. Implement `put/get/delete` against the bucket (key = booking number,
   private bucket, lifecycle rule for 90-day expiry).
2. Copy existing photos across with a one-off script, then flip the store.
3. Nothing else changes: routes, validation, the admin viewer and the browser
   code are unaffected.

## Privacy and security notes

- The upload form states who sees the photo and how long it is kept, and asks
  the customer to consent before a photo is attached.
- Photos are served only to logged-in admins, with `Cache-Control: private,
  no-store` and `X-Content-Type-Options: nosniff`.
- Customers can delete their own photo with their receipt token.
- The server never trusts the client's type claim and never renders the file as
  HTML.

## Action items

1. [x] Add `bookingphotos` collection with 90-day TTL and `hasPhoto` booking flag
2. [x] Upload, delete and admin-view routes with validation and rate limiting
3. [x] Optional upload section in the booking form with client-side resize
4. [x] Admin booking dialog shows the photo, with a remove option
5. [x] Tests: API, database behaviour, and the browser flow
6. [ ] Decide a retention period with the owner (90 days is the default)
7. [ ] Add the photo retention wording to the site's privacy notice
