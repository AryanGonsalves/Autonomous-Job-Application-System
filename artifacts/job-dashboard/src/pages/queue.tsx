import { useState } from "react";
import { format } from "date-fns";
import {
  useListJobs,
  useDeleteJob,
  useUpdateJobStatus,
  getListJobsQueryKey,
  useGetJobPreview,
  useGenerateCoverLetter
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Trash2, XCircle, FileText, ChevronLeft, ChevronRight, Wand2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

const PLATFORM_COLORS: Record<string, string> = {
  linkedin: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  indeed: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300",
  greenhouse: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  lever: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
};

export function Queue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const limit = 12;
  const [previewId, setPreviewId] = useState<number | null>(null);

  const queryParams = { status: "queued" as const, limit, offset: (page - 1) * limit };
  const { data, isLoading } = useListJobs(queryParams, {
    query: { queryKey: getListJobsQueryKey(queryParams) }
  });

  const updateStatus = useUpdateJobStatus();
  const deleteJob = useDeleteJob();
  const generateCL = useGenerateCoverLetter();
  const [retrying, setRetrying] = useState(false);

  const handleRetryFailed = async () => {
    setRetrying(true);
    try {
      const res = await fetch("/api/jobs/retry-failed", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: `Failed to reset jobs: ${body.message ?? res.statusText}`, variant: "destructive" });
        return;
      }
      toast({ title: "Failed & skipped jobs reset to queued" });
      await queryClient.refetchQueries({ queryKey: getListJobsQueryKey(queryParams), exact: true });
      await queryClient.refetchQueries({ queryKey: getListJobsQueryKey(), exact: false });
    } catch (err) {
      toast({ title: `Failed to reset jobs: ${String(err)}`, variant: "destructive" });
    } finally {
      setRetrying(false);
    }
  };

  const handleSkip = (id: number) => {
    updateStatus.mutate(
      { id, data: { status: "skipped" as any } },
      {
        onSuccess: () => {
          toast({ title: "Job skipped" });
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey(queryParams) });
        }
      }
    );
  };

  const handleRemove = (id: number) => {
    deleteJob.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Job removed from queue" });
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey(queryParams) });
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Job Queue</h1>
          <p className="text-muted-foreground">Review jobs scraped and waiting for automation.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRetryFailed} disabled={retrying}>
          {retrying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Retry Failed
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-64 justify-center items-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (!data?.jobs || data.jobs.length === 0) ? (
        <Card className="flex h-64 flex-col items-center justify-center text-center">
          <CardHeader>
            <CardTitle>Queue is Empty</CardTitle>
            <CardDescription>No jobs waiting to be applied to.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.jobs.map((job) => (
              <Card key={job.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <Badge variant="secondary" className={`capitalize ${PLATFORM_COLORS[job.platform]} border-transparent mb-2`}>
                      {job.platform}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(job.scrapedAt), "MMM d")}
                    </span>
                  </div>
                  <CardTitle className="text-lg line-clamp-2" title={job.jobTitle}>{job.jobTitle}</CardTitle>
                  <CardDescription className="font-medium text-foreground">
                    {job.company}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>{job.location || "Location not specified"}</p>
                    {job.remote && <Badge variant="outline" className="text-[10px]">Remote</Badge>}
                  </div>
                  {job.jobDescription && (
                    <p className="mt-4 text-xs text-muted-foreground line-clamp-3">
                      {job.jobDescription}
                    </p>
                  )}
                </CardContent>
                <CardFooter className="pt-0 flex gap-2 border-t mt-auto px-6 py-4">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setPreviewId(job.id)}>
                    <FileText className="w-4 h-4 mr-2" /> Preview
                  </Button>
                  <Button variant="ghost" size="icon" title="Skip" onClick={() => handleSkip(job.id)}>
                    <XCircle className="w-4 h-4 text-muted-foreground" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Remove" onClick={() => handleRemove(job.id)} className="hover:text-destructive hover:bg-destructive/10">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>

          {data.total > limit && (
            <div className="flex items-center justify-between border-t pt-4">
              <span className="text-sm text-muted-foreground">
                Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, data.total)} of {data.total}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Prev
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * limit >= data.total}>
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {previewId !== null && (
        <PreviewDialog 
          id={previewId} 
          onOpenChange={(open) => !open && setPreviewId(null)} 
        />
      )}
    </div>
  );
}

function PreviewDialog({ id, onOpenChange }: { id: number; onOpenChange: (open: boolean) => void }) {
  const { data, isLoading } = useGetJobPreview(id, { query: { queryKey: ["/api/jobs", id, "preview"], enabled: !!id } });
  const generateCL = useGenerateCoverLetter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleGenerate = () => {
    generateCL.mutate(
      { data: { jobId: id } },
      {
        onSuccess: () => {
          toast({ title: "Cover letter generated" });
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        },
        onError: () => {
          toast({ title: "Failed to generate", variant: "destructive" });
        }
      }
    );
  };

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Job Preview</DialogTitle>
          <DialogDescription>Review details before the automation processes this job.</DialogDescription>
        </DialogHeader>
        
        {isLoading || !data ? (
          <div className="flex justify-center items-center py-20 flex-1">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            <div className="mb-4">
              <h3 className="text-xl font-bold">{data.job.jobTitle}</h3>
              <p className="text-muted-foreground">{data.job.company} • {data.job.location}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4 flex-1 overflow-hidden min-h-0">
              <div className="flex flex-col border rounded-md min-h-0">
                <div className="bg-muted px-3 py-2 border-b font-medium text-sm">Job Description</div>
                <ScrollArea className="flex-1 p-3 text-sm whitespace-pre-wrap text-muted-foreground">
                  {data.job.jobDescription || "No description available."}
                </ScrollArea>
              </div>
              
              <div className="flex flex-col border rounded-md min-h-0 relative">
                <div className="bg-muted px-3 py-2 border-b flex justify-between items-center">
                  <span className="font-medium text-sm">Cover Letter</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 text-xs" 
                    onClick={handleGenerate}
                    disabled={generateCL.isPending}
                  >
                    {generateCL.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3 mr-1" />}
                    Regenerate
                  </Button>
                </div>
                <ScrollArea className="flex-1 p-3 text-sm whitespace-pre-wrap">
                  {data.coverLetter ? data.coverLetter : (
                    <span className="text-muted-foreground italic">No cover letter generated yet.</span>
                  )}
                </ScrollArea>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
