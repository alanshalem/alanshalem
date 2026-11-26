---
name: dotnet-api-conventions
description: "Conventions of the .NET 10 API in apps/api (Clean Architecture with Domain, Application, Infrastructure and Api layers, EF Core + SQLite) covering entities and validated content records, DomainException with MessageKeys and the es/en MessageCatalog, ports and repositories, minimal-API endpoint modules, rebuild triggers and the EF Core migrations workflow. Use when adding or changing anything under apps/api, including a field, a validation rule, an error message, an endpoint or a database migration."
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
- **Api** (`src/Blog.Api`): `Program.cs` (options validated on start, auth, CSRF middleware, rate limit, groups),
  `Endpoints/*Endpoints.cs`, `Http/ApiExceptionHandler.cs`, `Http/RequestLanguage.cs`.

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
- `ApiExceptionHandler` maps exception type → status, writes `title`/`detail` in the request language
  (`RequestLanguage.Of`: first `Accept-Language` preference `en*` → English, else Spanish), adds `code` and
  `Vary: Accept-Language`. Unexpected exceptions are 500 without details and are logged.
- Log and exception `Message` text stays Spanish (default language).

## Use cases

- Validate first, then read, then mutate, then `SaveChangesAsync`, then side effects. A rejected request changes
  nothing (`SiteSettingsService.SaveAsync`).
- Anything that changes public pages calls `ISiteBuildTrigger.RequestBuildAsync` after saving. It never throws.
- Concurrency/uniqueness races surface as `ConflictException` from the repository's `SaveChangesAsync`
  (`SqliteConventions.IsConstraintViolation`).
- Slow work (video) goes through a queue consumed by one hosted worker; image processing is serialized by a
  singleton semaphore. Keep heavy work out of request threads.

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

## Style

- XML doc comments and inline comments in Spanish explaining *why*; file-scoped namespaces; primary constructors
  for services and adapters; `CancellationToken` on every async method.
- Tests: xUnit, names `Subject_does_this_when_that` (skill `testing-tdd`).

## Checklist

- [ ] Rule and limit in the domain, message key + es/en catalog entry, test for the rule.
- [ ] Admin `limits.ts` updated if a mirrored constant changed.
- [ ] New port → interface in `Ports.cs`, adapter `internal sealed` in Infrastructure, registered in DI.
- [ ] Endpoint maps only its own routes and is covered by an HTTP test (`Http/ApiFactory`).
- [ ] Rebuild requested when public output changes.
- [ ] Migration generated with dotnet-ef, preserves data, tested.

## Anti-patterns seen here

- Generic conflict text in a repository instead of a specific key (rediseno-editorial L7).
- A `nameof` pointing to the wrong argument in a guard (hero-galeria L23 R2-misleading-argname).
- Comments that cite a spec id ("S12") without stating the rule (L23): write the rule.
- Swallowing a `VipsException` without logging (L14 R4-silent-vips-catch).
- Reporting success before verifying files exist on disk (dedupe without file check, L14/L20).
