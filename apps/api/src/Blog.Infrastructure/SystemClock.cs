using Blog.Application.Abstractions;

namespace Blog.Infrastructure;

internal sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}
