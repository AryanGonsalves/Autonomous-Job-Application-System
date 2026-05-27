import { useEffect, useState, useRef } from "react";
import { format, formatDuration, intervalToDuration } from "date-fns";
import {
  useGetSchedulerStatus,
  useGetSchedulerLogs,
  useGetRunHistory,
  useStartScheduler,
  useStopScheduler,
  useRunNow,
  useUpdateSchedulerSlots,
  useStopCurrentRun,
  getGetSchedulerStatusQueryKey,
  getGetSchedulerLogsQueryKey,
  getGetRunHistoryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Play, Square, Zap, Activity, Clock, Timer, History, StopCircle, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const LOG_COLORS: Record<string, string> = {
  info: "text-blue-500",
  warn: "text-amber-500",
  error: "text-red-500 text-bold",
  debug: "text-muted-foreground",
};

function formatCountdown(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "--:--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function formatDurationMs(ms: number | null | undefined): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export function Scheduler() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const logsEndRef = useRef<HTMLDivElement>(null);

  const [countdownTick, setCountdownTick] = useState(0);
  const [slots, setSlots] = useState(["", "", ""]);
  const [slotsInitialized, setSlotsInitialized] = useState(false);

  const { data: status, isLoading: loadingStatus } = useGetSchedulerStatus({
    query: { queryKey: getGetSchedulerStatusQueryKey(), refetchInterval: 5000 },
  });

  const { data: logsData } = useGetSchedulerLogs({ limit: 100 }, {
    query: { queryKey: getGetSchedulerLogsQueryKey({ limit: 100 }), refetchInterval: (status?.running || status?.isRunningPipeline) ? 2000 : false },
  });

  const { data: historyData, isLoading: loadingHistory } = useGetRunHistory({ limit: 30 }, {
    query: { queryKey: getGetRunHistoryQueryKey({ limit: 30 }), refetchInterval: 15000 },
  });

  const startMut = useStartScheduler();
  const stopMut = useStopScheduler();
  const runNowMut = useRunNow();
  const updateSlotsMut = useUpdateSchedulerSlots();
  const stopRunMut = useStopCurrentRun();

  // Live countdown tick every second
  useEffect(() => {
    const id = setInterval(() => setCountdownTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Compute live countdown from lastFetched nextRunIn + elapsed
  const [fetchedAt, setFetchedAt] = useState<number>(Date.now());
  const [baseNextRunIn, setBaseNextRunIn] = useState<number | null>(null);

  useEffect(() => {
    if (status?.nextRunIn != null) {
      setBaseNextRunIn(status.nextRunIn);
      setFetchedAt(Date.now());
    }
  }, [status?.nextRunIn]);

  const liveCountdown =
    baseNextRunIn != null
      ? Math.max(0, baseNextRunIn - Math.floor((Date.now() - fetchedAt) / 1000))
      : null;

  // Initialize slot inputs from status
  useEffect(() => {
    if (status?.slots && !slotsInitialized) {
      const s = [...status.slots, "", "", ""].slice(0, 3) as [string, string, string];
      setSlots(s);
      setSlotsInitialized(true);
    }
  }, [status?.slots, slotsInitialized]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logsData]);

  const handleStart = () => {
    startMut.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Scheduler enabled" });
        queryClient.invalidateQueries({ queryKey: getGetSchedulerStatusQueryKey() });
        setSlotsInitialized(false);
      },
    });
  };

  const handleStop = () => {
    stopMut.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Scheduler disabled" });
        queryClient.invalidateQueries({ queryKey: getGetSchedulerStatusQueryKey() });
      },
    });
  };

  const handleRunNow = () => {
    runNowMut.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Manual run started" });
        queryClient.invalidateQueries({ queryKey: getGetSchedulerStatusQueryKey() });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: getGetRunHistoryQueryKey() });
        }, 2000);
      },
    });
  };

  const handleStopRun = () => {
    stopRunMut.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Stop requested — finishing current step" });
        queryClient.invalidateQueries({ queryKey: getGetSchedulerStatusQueryKey() });
      },
    });
  };

  const handleSaveSlots = () => {
    const cleanedSlots = slots.filter(Boolean);
    if (!cleanedSlots.length) {
      toast({ title: "Enter at least one time slot", variant: "destructive" });
      return;
    }
    updateSlotsMut.mutate(
      { data: { slots: cleanedSlots } },
      {
        onSuccess: () => {
          toast({ title: "Schedule updated" });
          setSlotsInitialized(false);
          queryClient.invalidateQueries({ queryKey: getGetSchedulerStatusQueryKey() });
        },
        onError: () => toast({ title: "Failed to update slots", variant: "destructive" }),
      }
    );
  };

  const isPipelineRunning = !!(status?.currentRunStartedAt);

  if (loadingStatus) {
    return (
      <div className="flex h-[50vh] justify-center items-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Automation Engine</h1>
          <p className="text-muted-foreground">Schedule, monitor, and control your job application runs.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isPipelineRunning && (
            <Button variant="outline" size="sm" onClick={handleStopRun} disabled={stopRunMut.isPending}>
              {stopRunMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <StopCircle className="w-4 h-4 mr-2" />}
              Stop Current Run
            </Button>
          )}
          {status?.running ? (
            <Button variant="destructive" onClick={handleStop} disabled={stopMut.isPending}>
              {stopMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Square className="w-4 h-4 mr-2" fill="currentColor" />}
              Disable Scheduler
            </Button>
          ) : (
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleStart} disabled={startMut.isPending}>
              {startMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" fill="currentColor" />}
              Enable Scheduler
            </Button>
          )}
          <Button variant="outline" onClick={handleRunNow} disabled={runNowMut.isPending || isPipelineRunning}>
            {runNowMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
            Run Now
          </Button>
        </div>
      </div>

      {/* Status row */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Engine Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="w-4 h-4 text-primary" />
              Engine Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center border-b pb-3">
              <span className="text-sm text-muted-foreground">State</span>
              <Badge variant="outline" className={status?.running ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-slate-100 text-slate-800"}>
                {status?.running ? (isPipelineRunning ? "Running pipeline" : "Scheduled") : "Idle"}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Current Phase</span>
              <span className="text-sm font-medium capitalize">{status?.currentPhase || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Applied Today</span>
              <span className="text-sm font-medium">{status?.applicationsToday ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Last Run</span>
              <span className="text-sm font-medium">
                {status?.lastRun ? format(new Date(status.lastRun), "MMM d, h:mm a") : "Never"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Countdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Timer className="w-4 h-4 text-primary" />
              Next Run Countdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-2">
              <div className="text-4xl font-mono font-bold tracking-wider text-primary tabular-nums">
                {isPipelineRunning
                  ? <span className="text-emerald-600 text-3xl">Running…</span>
                  : status?.running
                  ? formatCountdown(liveCountdown)
                  : "--:--:--"}
              </div>
              {status?.nextRun && !isPipelineRunning && (
                <p className="text-xs text-muted-foreground mt-2">
                  Scheduled for {format(new Date(status.nextRun), "MMM d 'at' h:mm a")}
                </p>
              )}
              {!status?.running && (
                <p className="text-xs text-muted-foreground mt-2">Enable the scheduler to start countdown</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Daily Slots */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4 text-primary" />
              Daily Run Slots
            </CardTitle>
            <CardDescription className="text-xs">Up to 3 times per day</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <Label className="text-xs w-12 text-muted-foreground">Slot {i + 1}</Label>
                <Input
                  type="time"
                  value={slots[i] ?? ""}
                  onChange={(e) => {
                    const next = [...slots] as [string, string, string];
                    next[i] = e.target.value;
                    setSlots(next);
                  }}
                  className="h-8 text-sm"
                />
              </div>
            ))}
            <Button
              size="sm"
              className="w-full mt-1"
              onClick={handleSaveSlots}
              disabled={updateSlotsMut.isPending}
            >
              {updateSlotsMut.isPending ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Save className="w-3 h-3 mr-2" />}
              Save Schedule
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Live logs */}
      <Card className="flex flex-col">
        <CardHeader className="pb-3 border-b">
          <CardTitle>Live Output</CardTitle>
          <CardDescription>Real-time automation logs</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 p-0 bg-slate-950 font-mono text-sm rounded-b-lg">
          <div className="h-[500px] overflow-y-auto p-4" style={{ scrollbarColor: "#475569 #0f172a" }}>
            {(!logsData?.logs || logsData.logs.length === 0) ? (
              <div className="text-slate-500 italic">No logs available…</div>
            ) : (
              logsData.logs.map((log, i) => (
                <div key={i} className="mb-1 flex gap-3 leading-relaxed">
                  <span className="text-slate-500 whitespace-nowrap">
                    {format(new Date(log.timestamp), "HH:mm:ss.SSS")}
                  </span>
                  <span className={`w-12 font-semibold ${LOG_COLORS[log.level ?? "info"] ?? ""}`}>
                    [{(log.level ?? "info").toUpperCase()}]
                  </span>
                  {log.platform && (
                    <span className="text-purple-400">({log.platform})</span>
                  )}
                  <span className="text-slate-300 whitespace-pre-wrap break-all">{log.message}</span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </CardContent>
      </Card>

      {/* Run History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            Run History
          </CardTitle>
          <CardDescription>Last 30 automation runs</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingHistory ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !historyData || historyData.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No runs yet. Click <strong>Run Now</strong> or enable the scheduler to start.
            </div>
          ) : (
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead className="text-right">Scraped</TableHead>
                    <TableHead className="text-right">Applied</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead className="text-right">Filtered (non-US)</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyData.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="text-sm whitespace-nowrap">
                        {format(new Date(run.startedAt), "MMM d, h:mm a")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {run.triggeredBy}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{run.jobsScraped}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-emerald-600">{run.jobsApplied}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-red-500">{run.jobsFailed}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-amber-600">{run.jobsFilteredNonUs}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {formatDurationMs(run.durationMs)}
                      </TableCell>
                      <TableCell>
                        {run.finishedAt ? (
                          <Badge className="text-xs bg-emerald-100 text-emerald-800 border-emerald-200">Complete</Badge>
                        ) : (
                          <Badge className="text-xs bg-blue-100 text-blue-800 border-blue-200 animate-pulse">Running</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
