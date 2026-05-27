import { useState } from "react";
import { format } from "date-fns";
import { 
  useListApplications, 
  useUpdateApplicationStatus,
  getListApplicationsQueryKey
} from "@workspace/api-client-react";
import { ApplicationStatus, ListApplicationsPlatform } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, ExternalLink, ChevronLeft, ChevronRight, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PLATFORM_COLORS: Record<string, string> = {
  linkedin: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  indeed: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300",
  greenhouse: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  lever: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
};

const STATUS_COLORS: Record<string, string> = {
  applied: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  interview: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  offer: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800",
  rejected: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
};

export function Applications() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const limit = 20;
  
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");

  const queryParams: any = { limit, offset: (page - 1) * limit };
  if (keyword) queryParams.keyword = keyword;
  if (statusFilter !== "all") queryParams.status = statusFilter;
  if (platformFilter !== "all") queryParams.platform = platformFilter;

  const { data, isLoading } = useListApplications(queryParams, {
    query: {
      queryKey: getListApplicationsQueryKey(queryParams)
    }
  });

  const updateStatus = useUpdateApplicationStatus();

  const handleEmailSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/import/email", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json() as { imported: number; updated: number; details: Array<{ company: string; oldStatus: string; newStatus: string }> };
      const parts: string[] = [];
      if (result.imported > 0) parts.push(`Imported ${result.imported} application${result.imported !== 1 ? "s" : ""}`);
      if (result.updated > 0) {
        const rejections = result.details.filter((d) => d.newStatus === "rejected").length;
        const interviews = result.details.filter((d) => d.newStatus === "interview").length;
        const offers = result.details.filter((d) => d.newStatus === "offer").length;
        const statusParts: string[] = [];
        if (rejections > 0) statusParts.push(`${rejections} rejection${rejections !== 1 ? "s" : ""}`);
        if (interviews > 0) statusParts.push(`${interviews} interview${interviews !== 1 ? "s" : ""}`);
        if (offers > 0) statusParts.push(`${offers} offer${offers !== 1 ? "s" : ""}`);
        parts.push(`Updated ${result.updated} status${result.updated !== 1 ? "es" : ""}${statusParts.length ? ` (${statusParts.join(", ")})` : ""}`);
      }
      toast({ title: parts.length ? parts.join(". ") + "." : "Email sync complete — no changes found." });
      if (result.imported > 0 || result.updated > 0) {
        queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey(queryParams) });
      }
    } catch (err) {
      toast({ title: "Email sync failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setKeyword(searchInput);
    setPage(1);
  };

  const handleStatusChange = (id: number, newStatus: string) => {
    updateStatus.mutate(
      { 
        id, 
        data: { status: newStatus as any } 
      },
      {
        onSuccess: () => {
          toast({ title: "Status updated" });
          queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey(queryParams) });
        },
        onError: () => {
          toast({ title: "Failed to update status", variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Applications</h1>
          <p className="text-muted-foreground">Track and manage your submitted applications.</p>
        </div>
        <Button
          variant="outline"
          onClick={handleEmailSync}
          disabled={syncing}
          data-testid="button-sync-email"
        >
          {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
          Sync Email
        </Button>
      </div>

      <div className="bg-card rounded-lg border shadow-sm">
        <div className="p-4 border-b flex flex-col sm:flex-row gap-4 justify-between items-center bg-muted/20">
          <form onSubmit={handleSearch} className="flex w-full sm:max-w-sm relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search companies, roles..."
              className="pl-9"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <Button type="submit" variant="secondary" className="ml-2">Search</Button>
          </form>
          
          <div className="flex w-full sm:w-auto gap-4">
            <Select value={platformFilter} onValueChange={(val) => { setPlatformFilter(val); setPage(1); }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                <SelectItem value="linkedin">LinkedIn</SelectItem>
                <SelectItem value="indeed">Indeed</SelectItem>
                <SelectItem value="greenhouse">Greenhouse</SelectItem>
                <SelectItem value="lever">Lever</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={(val) => { setStatusFilter(val); setPage(1); }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="applied">Applied</SelectItem>
                <SelectItem value="interview">Interviewing</SelectItem>
                <SelectItem value="offer">Offer</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="relative w-full overflow-auto">
          {isLoading ? (
            <div className="flex justify-center items-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role & Company</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Applied Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!data?.applications || data.applications.length === 0) ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      No applications found.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.applications.map((app) => (
                    <TableRow key={app.id}>
                      <TableCell>
                        <div className="font-medium text-base">{app.job.jobTitle}</div>
                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                          {app.job.company}
                          {app.job.location && <span>• {app.job.location}</span>}
                          {app.job.remote && <Badge variant="outline" className="text-[10px] h-4 px-1">Remote</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={`capitalize ${PLATFORM_COLORS[app.job.platform] || ''} border-transparent`}>
                          {app.job.platform}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {(app as any).source === "imported" ? (
                          <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800">
                            Imported
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800">
                            Bot
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {format(new Date(app.appliedAt), "MMM d, yyyy")}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select 
                          defaultValue={app.status} 
                          onValueChange={(val) => handleStatusChange(app.id, val)}
                        >
                          <SelectTrigger className={`w-[130px] h-8 text-xs capitalize ${STATUS_COLORS[app.status] || ''}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="applied">Applied</SelectItem>
                            <SelectItem value="interview">Interview</SelectItem>
                            <SelectItem value="offer">Offer</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <a href={app.job.applyUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4" />
                            <span className="sr-only">View Posting</span>
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
        
        {data && data.total > limit && (
          <div className="p-4 border-t flex items-center justify-between text-sm text-muted-foreground">
            <div>
              Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, data.total)} of {data.total}
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setPage(p => p + 1)}
                disabled={page * limit >= data.total}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
