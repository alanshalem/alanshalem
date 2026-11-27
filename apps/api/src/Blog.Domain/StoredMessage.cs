namespace Blog.Domain;

/// <summary>
/// A message stored in the database to be shown later (a video's error): the <see cref="MessageCatalog"/> key, without
/// arguments, written in the reader's language. Rows from before the catalog stored the text already written in
/// Spanish: that text is not a key and is shown as is, so no old row becomes unreadable.
/// </summary>
public sealed record StoredMessage(string Value)
{
    /// <exception cref="ArgumentOutOfRangeException">If the language is not one of <see cref="Language"/>.</exception>
    public string In(string language) =>
        MessageCatalog.Entries.ContainsKey(Value) ? MessageCatalog.Format(new UserMessage(Value), language) : Value;
}
