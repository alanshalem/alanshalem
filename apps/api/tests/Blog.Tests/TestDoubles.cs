using Blog.Application.Abstractions;

namespace Blog.Tests;

internal sealed class FixedClock : IClock
{
    public DateTime UtcNow { get; set; } = new(2026, 11, 25, 12, 0, 0, DateTimeKind.Utc);
}

internal sealed class CountingBuildTrigger : ISiteBuildTrigger
{
    public int Requests { get; private set; }

    public Task RequestBuildAsync(CancellationToken cancellationToken)
    {
        Requests++;
        return Task.CompletedTask;
    }
}
