---
name: dotnet-api-conventions
description: "Conventions of the .NET 10 API in apps/api (Clean Architecture with Domain, Application, Infrastructure and Api layers, EF Core + SQLite) covering entities and validated content records, DomainException with MessageKeys and the es/en MessageCatalog, ProblemDetails with a stable code for every error, ports and repositories, minimal-API endpoint modules, health endpoints, the command-line modes (hash-password, healthcheck, backup), the admin session epoch, trusted proxies, rebuild triggers and the EF Core migrations workflow. Use when adding or changing anything under apps/api, including a field, a validation rule, an error message, an endpoint, a CLI mode, authentication or a database migration."
---

# .NET API conventions (`apps/api`)

## Layers and the dependency rule

```
Blog.Api ──► Blog.Application ──► Blog.Domain
   └──────► Blog.Infrastructure ──┘ (implements Application ports)
```

- **Domain** (`src/Blog.Domain`): entities, value rules, message keys and catalog. No EF, no ASP.NET, no I/O.
- **Application** (`src/Blog.Application`): use-case services (`PostService`, `SiteSettingsService`,
  `HeroImageService`, `MediaService`, `VideoService`, `VideoProcessor`), DTOs, ports in `Abstractions/Ports.cs`,
  `NotFoundException` / `ConflictException` in `Errors.cs`.
- **Infrastructure** (`src/Blog.Infrastructure`): `internal sealed` adapters (repositories, `DiskMediaStorage`,
  `NetVipsImageProcessor`, `FfmpegVideoTranscoder`, workers), all wired in `DependencyInjection.cs`.
- **Api** (`src/Blog.Api`): `Program.cs` (CLI modes first, options validated on start, auth, CSRF middleware, rate
  limit, groups), `Endpoints/*Endpoints.cs`, `Cli/` (command-line modes), `Security/` (session, password hasher
  `Pbkdf2PasswordHasher`, rate limit, trusted proxies, builder token), `Http/` (`ApiExceptionHandler`,
  `LocalizedProblems`, `RequestLanguage`, `StoredMessageJsonConverter`, `UserMessageJsonConverter`).

## Domain model

- Entities are `sealed`, setters `private`, a private parameterless constructor for EF, and a static `Create(...)`
  plus intention methods (`Update`, `Publish`, `Schedule`). See `Blog.Domain/SiteSettings.cs`, `Post.cs`.
- Input is validated by an immutable `*Content` record with a static `Create` that trims, normalizes and throws
  (`PostContent`, `SiteSettingsContent`, `HeroImageContent`). "If an instance exists, it is valid."
- Limits are `public const` on the record (`PostContent.MaxTitleLength = 200`). The admin mirrors them in
  `apps/admin/src/limits.ts`, and `apps/admin/test/limits.test.ts` parses these C# files: rename or change a constant
  and update both.
- Two fixed languages (`Language.Spanish`, `Language.English`, `Language.Default`). Spanish fields are unsuffixed;
  English variants are `...En` fields with fallback (never for proper names; see skill `bilingual-i18n`).

## Errors and messages

```csharp
throw new DomainException(MessageKeys.PostTitleTooLong, ("max", MaxTitleLength));   // 400
throw new NotFoundException(MessageKeys.PostNotFound);                              // 404
throw new ConflictException(MessageKeys.PostSlugTaken,                              // 409
    ("language", Language.NameOf(lang)), ("slug", slug));   // nested message: the language name is translated too
```

- Never put user-facing text in code: add a key to `MessageKeys.cs` (`area.camelCase`; a published key is never
  renamed, it is the stable `code` clients switch on) and its entry in `MessageCatalog.cs` with Spanish and English
  texts that have the same `{placeholders}`. `MessageCatalogTests` enforces one entry per key, both languages, same
  placeholders, key shape.
- **Every error is a ProblemDetails with `code`**, whoever writes it. `ApiExceptionHandler` maps exception type → status
  and writes `detail` in the request language (`RequestLanguage.Of`: first `Accept-Language` preference `en*` → English,
  else Spanish) with `code` = the detail's key. `app.UseStatusCodePages()` (registered right after
  `UseExceptionHandler`) turns the framework's empty 4xx/5xx (401, 403 from the CSRF check, 404, 405, 413, 415, 429)
  into problem details too. `LocalizedProblems.Localize` (`AddProblemDetails` → `CustomizeProblemDetails`) is the one
  place that finishes all of them: `title` from a `Problem*` key per status (`MessageKeys.ProblemNotFound`…), `code` =
  that key unless a more specific one is already there, and `Vary: Accept-Language`. Unexpected exceptions are 500
  without details and are logged; a `BadHttpRequestException` (malformed request, thrown only in Development) keeps
  its own status, so both environments answer the same.
- Messages stored for later (a video's processing error) are a `StoredMessage` holding the **key**, not text; the API
  writes it in the reader's language (`StoredMessageJsonConverter`). Old rows with Spanish text are shown as they are.
- Messages computed on the fly and returned in a DTO (a hero video's size warnings) travel as `UserMessage` and are
  written in the request language by the write-only `UserMessageJsonConverter` (JSON stays `string[]`). A request
  without `Accept-Language` (the builder) gets Spanish. Never call `UserMessage.ToString()` for text sent to a client.
- Log lines and developer exception `Message` texts are English (they are for operators, not readers); only the
  catalog's Spanish entries are Spanish.

## Use cases

- Validate first, then read, then mutate, then `SaveChangesAsync`, then side effects. A rejected request changes
  nothing (`SiteSettingsService.SaveAsync`).
- Anything that changes public pages calls `ISiteBuildTrigger.RequestBuildAsync` after saving. It never throws.
- Concurrency/uniqueness races surface as `ConflictException` from the repository's `SaveChangesAsync`
  (`SqliteConventions.IsConstraintViolation`).
- Slow work (video) goes through a queue consumed by one hosted worker; image processing is serialized by a
  singleton semaphore. Keep heavy work out of request threads.

## Health, command-line modes and security plumbing

- `GET /api/health`: the process is alive (Caddy's `health_uri`). `GET /api/health/ready`: also the database answers
  (`DatabaseReadiness`, a query on a real table: opening a missing file would create an empty database), else 503
  problem details.
- The same executable has command-line modes (`Cli/CommandLine.cs`); any other arguments start the API:

  | Mode | Does | Exit code |
  |---|---|---|
  | `hash-password` | reads the password without echo (or one line from redirected stdin), prompt on stderr, hash on stdout; ≥ 12 chars (`HashPasswordCommand.MinLength`) | 0 hash printed, 1 too short |
  | `healthcheck` | `GET http://localhost:8080/api/health/ready`, 3 s timeout (the image has no curl; compose healthcheck) | 0 on 2xx, 1 otherwise |
  | `backup <dir>` | consistent SQLite backup (`DatabaseBackup`, `BackupDatabase` with busy timeout) to `<dir>/blog-<UTC yyyyMMddTHHmmssZ>.db`, prints the path (`infra/backup.sh` reads it) | 0 written, 1 error or missing argument |

  A new mode gets a test of its output and exit codes (`HashPasswordCommandTests`, `BackupCommandTests`,
  `Http/HealthHttpTests`) and its row here.
- Admin session (`Security/AdminSession.cs`): cookie `__Host-admin` carries the `session_epoch` claim. Logout with a valid
  session calls `IAdminSessionEpoch.RevokeAllAsync` (port in `Blog.Application/Abstractions/Ports.cs`; the internal
  `AdminSessionEpoch` adapter in Infrastructure persists it in the database and caches it in a volatile int): every
  cookie issued before, even a copied one, is rejected. Revocation **fails closed** if refreshing the cached epoch
  fails. Api code depends on the port, never on `Blog.Infrastructure.Security`. A restored database brings back an
  older epoch, so `infra/restore.sh` always starts with a fresh Data Protection key ring (old cookies cannot even be
  decrypted).
  Failed logins are logged with the client IP only.
- Trusted proxies (`Security/TrustedProxies.cs`): `X-Forwarded-For`/`-Proto` are believed only from
  `ForwardedHeaders:KnownNetworks` (CIDR list; default the Docker private ranges + loopback). An invalid CIDR stops the
  API at startup. Without it the login rate limit would see Caddy's IP for everyone.
- Production logs are JSON lines (`Logging__Console__FormatterName=json`); upload temp files go to `ASPNETCORE_TEMP`
  (the container filesystem is read-only).

## Endpoints

- One static class per area with `Map<Admin|Internal><Area>Endpoints(this RouteGroupBuilder group)`; it maps only its
  routes. Protection is applied once, on the groups in `Program.cs`: `/api/admin` → `RequireAuthorization()`,
  `/api/internal` → `BuilderTokenFilter`.
- Handlers are one-liners delegating to the service; `Results.Created(...)` for creations, `NoContent` for deletes.
- Mutations require `X-Requested-With: blog-admin` (middleware). Do not add CORS.

## Migrations workflow (EF Core, SQLite)

```bash
cd apps/api
dotnet tool restore
dotnet ef migrations add AddSomething --project src/Blog.Infrastructure --output-dir Persistence/Migrations
dotnet test
```

- Entity configuration lives in `Persistence/<Entity>Configuration.cs`; snake_case table names as existing ones.
- Migrations preserve data: backfill new columns from existing rows (`AddPostContentUpdatedAt` copies the newest
  revision; `AddTranslations` puts each post in its own group). Never `EnsureCreated`; never delete a dev database —
  rename to `.bak` (`DatabaseInitializer` refuses legacy databases with a clear message).
- `DatabaseInitializer` applies pending migrations at startup and enables WAL.
- Each data-moving migration gets an upgrade test in `PersistenceTests.cs` named
  `Upgrading_from_<PreviousMigration>_keeps_...` that seeds the old schema and checks the migrated rows.
- A schema/migration task is high risk: its own commit, with tests over the migrated data (skill `commit-and-review`).
- If `Down` cannot be lossless, document why in the migration (see `AddTranslations`).

## Configuration and packages

- Package versions only in `Directory.Packages.props` (central management); `.csproj` names packages only.
- Required options are validated with `ValidateOnStart` (`Admin:PasswordHash`, `Builder:Token` ≥ 32 chars).
- Secrets come from env vars / user-secrets; never commit or read them. `dotnet run --project src/Blog.Api --
  hash-password` produces a password hash.
- CI (`.github/workflows/ci.yml`) builds with `dotnet build -warnaserror` and runs every test, Ffmpeg included, inside the
  `dev` target of `apps/api/Dockerfile`; it also fails on any `dotnet list package --vulnerable --include-transitive`
  finding. A new warning breaks CI: fix it, do not suppress it without a comment saying why.

## Style

- XML doc comments and inline comments in English explaining *why*; file-scoped namespaces; primary constructors
  for services and adapters; `CancellationToken` on every async method.
- Tests: xUnit, names `Subject_does_this_when_that` (skill `testing-tdd`).

## Checklist

- [ ] Rule and limit in the domain, message key + es/en catalog entry, test for the rule.
- [ ] Admin `limits.ts` updated if a mirrored constant changed.
- [ ] New port → interface in `Ports.cs`, adapter `internal sealed` in Infrastructure, registered in DI.
- [ ] Endpoint maps only its own routes and is covered by an HTTP test (`Http/ApiFactory`), errors included (status,
      `code`, language).
- [ ] Rebuild requested when public output changes.
- [ ] Migration generated with dotnet-ef, preserves data, tested.
- [ ] `dotnet build -warnaserror` clean (CI).

## Anti-patterns seen here

- Generic conflict text in a repository instead of a specific key.
- A `nameof` pointing to the wrong argument in a guard (review R2-misleading-argname).
- Comments that cite a spec id without stating the rule: write the rule.
- Swallowing a `VipsException` without logging (review R4-silent-vips-catch).
- Reporting success before verifying files exist on disk (dedupe without a file check).
