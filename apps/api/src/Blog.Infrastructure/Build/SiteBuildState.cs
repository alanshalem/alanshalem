namespace Blog.Infrastructure.Build;

/// <summary>
/// The only row with the state of the site regeneration (table site_build_state, seeded by the migration). It is a table
/// of its own and not a settings column: that row does not exist until the first save from the admin, and this is
/// infrastructure state, not author data.
/// </summary>
internal sealed class SiteBuildState
{
    public const int SingletonId = 1;

    public int Id { get; set; }

    /// <summary>
    /// The latest regeneration request the builder has not accepted yet; null = nothing pending. Each new request
    /// replaces it, and only the OK of that same request clears it: an OK of an earlier one does not wipe a newer one.
    /// </summary>
    public Guid? PendingRequestId { get; set; }
}
