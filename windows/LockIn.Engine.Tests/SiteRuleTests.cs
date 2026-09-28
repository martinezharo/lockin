using LockIn.Engine.Models;
using LockIn.Engine.Rules;
using Xunit;

namespace LockIn.Engine.Tests;

/// <summary>The cases from tests/watchdog-sites.ps1, ported to the C# rules.</summary>
public sealed class SiteRuleTests
{
    [Fact]
    public void NormalizeSiteKeepsUrlSpecificity()
    {
        Assert.Equal("youtube.com/watch?v=AbC#details",
            SiteRules.NormalizeSite("https://WWW.YouTube.com/watch?v=AbC&utm_source=test#details"));
    }

    [Fact]
    public void PolicyFilterNeverBroadensFragments()
    {
        Assert.Equal("youtube.com/watch@v=ABC", SiteRules.PolicyFilter("youtube.com/watch?v=ABC"));
        Assert.Equal("", SiteRules.PolicyFilter("chatgpt.com/#settings/Personalization"));
    }

    [Theory]
    [InlineData("https://youtube.com/shorts/ABC", "youtube.com/shorts/", true)]
    [InlineData("https://youtube.com/watch?v=ABC", "youtube.com/shorts/", false)]
    [InlineData("https://youtube.com/Shorts/ABC", "youtube.com/shorts/", false)]
    [InlineData("http://youtube.com/watch?utm_source=x&v=ABC", "youtube.com/watch?v=ABC", true)]
    [InlineData("https://youtube.com/watch?v=abc", "youtube.com/watch?v=ABC", false)]
    [InlineData("https://youtube.com/watch?v=OTHER&v=ABC", "youtube.com/watch?v=ABC", true)]
    [InlineData("https://youtube.com.evil.test/watch?v=ABC", "youtube.com/watch?v=ABC", false)]
    [InlineData("https://example.com:8443/a", "example.com:8443/a", true)]
    [InlineData("https://example.com/a", "example.com:8443/a", false)]
    [InlineData("https://example.com/a?x=y%3Dz", "example.com/a?x%3Dy=z", false)]
    [InlineData("https://example.com/a?key", "example.com/a?key=", true)]
    [InlineData("https://chatgpt.com/#settings/Personalization", "chatgpt.com/#settings/Personalization", true)]
    [InlineData("https://chatgpt.com/#settings/General", "chatgpt.com/#settings/Personalization", false)]
    public void TestSiteMatchesFollowsTheDocumentedRules(string page, string rule, bool expected)
    {
        Assert.Equal(expected, SiteRules.TestSiteMatches(page, rule));
    }

    [Fact]
    public void NormalizeGroupsKeepsCaseSensitivePathsAndDropsInvalidExceptions()
    {
        var group = new Group
        {
            Id = "url",
            Name = "URL",
            Domains = new List<string> { "example.com/Path", "example.com/path" },
            Exceptions = new List<string> { "example.com/Path/free", "other.example/free", "example.com" }
        };
        var normalized = SiteRules.NormalizeGroups(new[] { group });
        Assert.Equal(2, normalized[0].Domains!.Count);
        Assert.Single(normalized[0].Exceptions!);
        Assert.Equal("example.com/Path/free", normalized[0].Exceptions![0]);
    }

    [Fact]
    public void GroupMatchingHonoursPathsAndExceptions()
    {
        var group = new Group
        {
            Id = "url",
            Domains = new List<string> { "example.com/Path", "example.com/path" },
            Exceptions = new List<string> { "example.com/Path/free" }
        };
        Assert.False(SiteRules.TestGroupMatchesHost(group, "example.com", "https://example.com/elsewhere"));
        Assert.True(SiteRules.TestGroupMatchesHost(group, "example.com", "https://example.com/Path"));

        var normalized = SiteRules.NormalizeGroups(new[] { group })[0];
        Assert.False(SiteRules.TestGroupMatchesHost(normalized, "example.com", "https://example.com/Path/free/report"));
    }

    [Fact]
    public void SendableUrlIsEmptyUnlessAConfiguredRuleMatches()
    {
        var groups = new List<Group>
        {
            new() { Domains = new List<string> { "youtube.com/watch?v=ABC" } }
        };
        Assert.Equal("", SiteRules.SendableUrl("https://youtube.com/watch?v=OTHER", groups));
        Assert.Equal("https://youtube.com/watch?v=ABC", SiteRules.SendableUrl("https://youtube.com/watch?v=ABC#frag", groups));

        var fragment = new List<Group>
        {
            new() { Domains = new List<string> { "chatgpt.com/#settings/Personalization" } }
        };
        Assert.Equal("https://chatgpt.com/#settings/Personalization",
            SiteRules.SendableUrl("https://chatgpt.com/#settings/Personalization", fragment));
        Assert.Equal("", SiteRules.SendableUrl("https://example.com/", groups));
    }

    [Fact]
    public void AppTargetsNormalizeToFileNames()
    {
        Assert.Equal("discord.exe", SiteRules.NormalizeAppTarget(@"C:\Users\x\AppData\Local\Discord\Discord.exe"));
        Assert.Equal("steam.exe", SiteRules.NormalizeAppTarget("Steam"));
        Assert.Equal("", SiteRules.NormalizeAppTarget("   "));
    }
}
