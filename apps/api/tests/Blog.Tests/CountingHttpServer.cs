using System.Net;
using System.Net.Sockets;
using System.Text;

namespace Blog.Tests;

/// <summary>
/// An in-process HTTP server on a random loopback port that counts every connection it accepts and answers each one
/// with the same body. A test points an external reference (an SVG's image, a DTD) at it to prove whether anything
/// was fetched: a count of 0 is evidence only because the same server is shown to count a real request.
/// </summary>
internal sealed class CountingHttpServer : IAsyncDisposable
{
    private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
    private readonly CancellationTokenSource _stop = new();
    private readonly byte[] _body;
    private readonly string _contentType;
    private readonly Task _loop;
    private int _connections;

    public CountingHttpServer(byte[] body, string contentType)
    {
        _body = body;
        _contentType = contentType;
        _listener.Start();
        _loop = AcceptAsync();
    }

    public int Connections => Volatile.Read(ref _connections);

    public string UrlOf(string path) => $"http://127.0.0.1:{((IPEndPoint)_listener.LocalEndpoint).Port}/{path}";

    private async Task AcceptAsync()
    {
        while (!_stop.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await _listener.AcceptTcpClientAsync(_stop.Token);
            }
            catch (Exception exception) when (exception is OperationCanceledException or ObjectDisposedException or SocketException)
            {
                return;
            }

            Interlocked.Increment(ref _connections);
            _ = AnswerAsync(client);
        }
    }

    private async Task AnswerAsync(TcpClient client)
    {
        using (client)
        {
            try
            {
                var stream = client.GetStream();
                var request = new byte[4096];
                _ = await stream.ReadAsync(request, _stop.Token);
                var head = Encoding.ASCII.GetBytes(
                    $"HTTP/1.1 200 OK\r\nContent-Type: {_contentType}\r\nContent-Length: {_body.Length}\r\nConnection: close\r\n\r\n");
                await stream.WriteAsync(head, _stop.Token);
                await stream.WriteAsync(_body, _stop.Token);
            }
            catch (Exception exception) when (exception is IOException or OperationCanceledException or ObjectDisposedException)
            {
                // The client went away: the connection was already counted, which is all a test asks.
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _stop.CancelAsync();
        _listener.Stop();
        await _loop;
        _stop.Dispose();
    }
}
