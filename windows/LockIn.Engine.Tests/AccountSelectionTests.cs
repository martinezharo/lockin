using LockIn.Engine.Installer;
using Xunit;

namespace LockIn.Engine.Tests;

public sealed class AccountSelectionTests
{
    private const string Alice = "S-1-5-21-1-1001";
    private const string Bob = "S-1-5-21-1-1002";
    private const string Carol = "S-1-5-21-1-1003";

    [Fact]
    public void DefaultsKeepExistingAccountsAndAddTheLaunchingOne()
    {
        var defaults = AccountSelection.Defaults(new[] { Alice, Bob }, Carol);
        Assert.Equal(new[] { Alice, Bob, Carol }, defaults);
        // The launching account is not duplicated when it is already protected.
        Assert.Equal(new[] { Alice, Bob }, AccountSelection.Defaults(new[] { Alice, Bob }, Alice));
    }

    [Fact]
    public void ASilentInstallKeepsTheExistingSet()
    {
        Assert.Equal(new[] { Alice, Bob, Carol }, AccountSelection.Merge(new[] { Alice, Bob }, Carol, null));
    }

    [Fact]
    public void TheCheckedAccountsAreTheFinalSet()
    {
        // Unchecking an account removes its protection; the launching account
        // is not silently re-added.
        Assert.Equal(new[] { Bob }, AccountSelection.Merge(new[] { Alice, Bob }, Alice, new[] { Bob }));
    }

    [Fact]
    public void InvalidAndDuplicateSidsAreDropped()
    {
        var merged = AccountSelection.Merge(null, null, new[] { Alice, "not-a-sid", Alice, Bob });
        Assert.Equal(new[] { Alice, Bob }, merged);
        Assert.Empty(AccountSelection.Merge(null, null, new[] { "not-a-sid" }));
        Assert.False(AccountSelection.IsValidSid(""));
    }
}
