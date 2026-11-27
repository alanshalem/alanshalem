namespace Blog.Infrastructure.Security;

/// <summary>
/// The only row with the admin session epoch (table admin_session, seeded by the migration). A table of its own and not
/// a column of another single row: the settings are author data (and do not exist until the first save) and
/// site_build_state is the state of the site regeneration.
/// </summary>
internal sealed class AdminSessionState
{
    public const int SingletonId = 1;

    public int Id { get; set; }

    /// <summary>Goes up by one each time every session is revoked (<see cref="AdminSessionEpoch.RevokeAllAsync"/>).</summary>
    public int Epoch { get; set; }
}
