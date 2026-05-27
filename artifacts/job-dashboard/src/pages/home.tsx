import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useGetStatsSummary,
  useGetDailyStats,
  useGetPlatformBreakdown,
  useGetRecentActivity,
  useGetStatusBreakdown,
} from "@workspace/api-client-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, Target, CheckCircle2, Clock, FilterX } from "lucide-react";
import { format } from "date-fns";

const PLATFORM_COLORS: Record<string, string> = {
  linkedin: "hsl(217, 91%, 60%)",
  indeed: "hsl(238, 83%, 62%)",
  greenhouse: "hsl(142, 71%, 45%)",
  lever: "hsl(24, 100%, 50%)",
  handshake: "hsl(275, 80%, 55%)",
};

const STATUS_COLORS: Record<string, string> = {
  applied: "hsl(217, 91%, 60%)",
  interview: "hsl(37, 90%, 51%)",
  offer: "hsl(142, 71%, 45%)",
  rejected: "hsl(0, 84%, 60%)",
};

export function Home() {
  const { data: summary, isLoading: loadingSummary } = useGetStatsSummary();
  const { data: dailyStats, isLoading: loadingDaily } = useGetDailyStats();
  const { data: platformStats, isLoading: loadingPlatform } = useGetPlatformBreakdown();
  const { data: statusStats, isLoading: loadingStatus } = useGetStatusBreakdown();
  const { data: activity, isLoading: loadingActivity } = useGetRecentActivity({ limit: 10 });

  if (loadingSummary || loadingDaily || loadingPlatform || loadingActivity || loadingStatus) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">Mission control for your automated job hunt.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Applied</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalAllTime || 0}</div>
            <p className="text-xs text-muted-foreground">
              +{summary?.totalToday || 0} today, +{summary?.totalThisWeek || 0} this week
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Queue Size</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalQueued || 0}</div>
            <p className="text-xs text-muted-foreground">Jobs waiting for application</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Interviews</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalInterviews || 0}</div>
            <p className="text-xs text-muted-foreground">
              {summary?.successRate ? `${summary.successRate}%` : "0%"} response rate
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Offers</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalOffers || 0}</div>
            <p className="text-xs text-muted-foreground">Total offers received</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Filtered (non-US)</CardTitle>
            <FilterX className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{summary?.totalFilteredNonUs || 0}</div>
            <p className="text-xs text-muted-foreground">Non-US jobs excluded this run</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Applications Sent</CardTitle>
            <CardDescription>Daily volume over the last 14 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyStats || []} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(val) => format(new Date(val), 'MMM d')}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} />
                  <RechartsTooltip 
                    contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                    labelFormatter={(val) => format(new Date(val), 'MMM d, yyyy')}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3 flex flex-col gap-4 bg-transparent border-0 shadow-none">
          <Card className="flex-1">
            <CardHeader className="pb-2">
              <CardTitle>Platform Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[150px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={platformStats || []}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="count"
                      nameKey="platform"
                    >
                      {(platformStats || []).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={PLATFORM_COLORS[entry.platform] || "hsl(var(--muted))"} />
                      ))}
                    </Pie>
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                      formatter={(value: number, name: string) => [value, name.charAt(0).toUpperCase() + name.slice(1)]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-1">
            <CardHeader className="pb-2">
              <CardTitle>Status Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2 pt-2">
                {(statusStats || []).map((stat) => (
                  <div key={stat.status} className="flex justify-between items-center text-sm">
                    <span className="capitalize">{stat.status}</span>
                    <span className="font-semibold">{stat.count}</span>
                  </div>
                ))}
                {(!statusStats || statusStats.length === 0) && (
                  <div className="text-sm text-muted-foreground">No applications found</div>
                )}
              </div>
            </CardContent>
          </Card>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {(!activity || activity.length === 0) ? (
              <div className="text-sm text-muted-foreground text-center py-4">No recent activity</div>
            ) : (
              activity.map((item) => (
                <div key={item.id} className="flex items-start justify-between border-b pb-4 last:border-0 last:pb-0">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {item.type === 'applied' && 'Applied to '}
                      {item.type === 'scraped' && 'Scraped '}
                      {item.type === 'status_change' && 'Status changed for '}
                      {item.type === 'failed' && 'Failed to apply to '}
                      <span className="font-bold">{item.jobTitle}</span> at <span className="font-bold">{item.company}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(item.timestamp), 'MMM d, h:mm a')} • {item.platform}
                      {item.details && ` • ${item.details}`}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {item.type.replace('_', ' ')}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
