using LockIn.Engine.Engine;
using LockIn.Engine.Platform;
using Xunit;

namespace LockIn.Engine.Tests;

public sealed class AppEnforcerTests
{
    private sealed class FakeProcessController : IAppProcessController
    {
        public List<AppProcess> Processes { get; } = new();
        public List<AppProcess> Closed { get; } = new();
        public List<AppProcess> Terminated { get; } = new();

        public IReadOnlyList<AppProcess> FindRunning(string executableName) =>
            Processes.Where(process => process.ExecutableName.Equals(executableName, StringComparison.OrdinalIgnoreCase)).ToList();

        public void CloseGracefully(AppProcess process) => Closed.Add(process);

        public void Terminate(AppProcess process)
        {
            Terminated.Add(process);
            Processes.RemoveAll(candidate => candidate.ProcessId == process.ProcessId);
        }
    }

    [Fact]
    public void ABlockedAppIsClosedThenTerminatedAfterTheGracePeriod()
    {
        var controller = new FakeProcessController();
        controller.Processes.Add(new AppProcess(42, "discord.exe"));
        controller.Processes.Add(new AppProcess(43, "steam.exe"));
        var clock = new FakeClock();
        var enforcer = new AppEnforcer(controller, clock, graceMs: 5000);

        enforcer.Apply(new[] { "discord.exe" });
        Assert.Single(controller.Closed);
        Assert.Equal(42, controller.Closed[0].ProcessId);
        Assert.Empty(controller.Terminated);

        clock.Advance(4999);
        enforcer.Apply(new[] { "discord.exe" });
        Assert.Empty(controller.Terminated);

        clock.Advance(1);
        enforcer.Apply(new[] { "discord.exe" });
        Assert.Single(controller.Terminated);
        Assert.Equal(42, controller.Terminated[0].ProcessId);
        // The unblocked app was never touched.
        Assert.DoesNotContain(controller.Closed, process => process.ProcessId == 43);
        Assert.DoesNotContain(controller.Terminated, process => process.ProcessId == 43);
    }

    [Fact]
    public void AnAppThatIsNoLongerBlockedIsForgotten()
    {
        var controller = new FakeProcessController();
        controller.Processes.Add(new AppProcess(42, "discord.exe"));
        var clock = new FakeClock();
        var enforcer = new AppEnforcer(controller, clock, graceMs: 5000);

        enforcer.Apply(new[] { "discord.exe" });
        enforcer.Apply(Array.Empty<string>());
        clock.Advance(10000);
        enforcer.Apply(new[] { "discord.exe" });
        // A fresh block starts with a fresh grace period and a polite close.
        Assert.Equal(2, controller.Closed.Count);
        Assert.Empty(controller.Terminated);
    }
}
