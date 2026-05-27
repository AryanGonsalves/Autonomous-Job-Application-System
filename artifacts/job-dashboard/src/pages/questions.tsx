import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  HelpCircle,
  CheckCircle2,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronUp,
  Brain,
  User,
  Cpu,
} from "lucide-react";

const API = "http://localhost:3000/api";

interface QuestionEntry {
  id: number;
  question: string;
  answer: string | null;
  source: "resume" | "ai" | "user" | "saved";
  confidence: number;
  needsReview: boolean;
  userNote: string | null;
  company: string | null;
  jobTitle: string | null;
  platform: string | null;
  createdAt: number;
}

interface QStats {
  total: number;
  needsReview: number;
  answered: number;
}

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    resume: { label: "Resume", variant: "secondary" },
    ai: { label: "AI", variant: "outline" },
    user: { label: "User", variant: "default" },
    saved: { label: "Saved", variant: "secondary" },
  };
  const info = map[source] ?? { label: source, variant: "outline" as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

function SourceIcon({ source }: { source: string }) {
  if (source === "resume") return <Brain className="w-3 h-3 text-blue-400" />;
  if (source === "user") return <User className="w-3 h-3 text-green-400" />;
  return <Cpu className="w-3 h-3 text-yellow-400" />;
}

function QuestionRow({ q, onSave, onDelete }: {
  q: QuestionEntry;
  onSave: (id: number, answer: string, note: string) => void;
  onDelete: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(q.needsReview);
  const [answer, setAnswer] = useState(q.answer ?? "");
  const [note, setNote] = useState(q.userNote ?? "");

  const confPct = Math.round((q.confidence ?? 0) * 100);
  const confColor =
    confPct >= 80 ? "text-green-400" : confPct >= 60 ? "text-yellow-400" : "text-red-400";

  return (
    <div className={`border rounded-lg p-4 space-y-3 ${q.needsReview ? "border-yellow-500/40 bg-yellow-500/5" : "border-border"}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {q.needsReview
            ? <HelpCircle className="w-4 h-4 text-yellow-400" />
            : <CheckCircle2 className="w-4 h-4 text-green-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">{q.question}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <SourceBadge source={q.source} />
            <span className={`text-xs ${confColor}`}>{confPct}% confidence</span>
            {q.platform && <Badge variant="outline" className="text-xs">{q.platform}</Badge>}
            {q.company && <span className="text-xs text-muted-foreground">{q.company}</span>}
            {q.jobTitle && <span className="text-xs text-muted-foreground">· {q.jobTitle}</span>}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {!expanded && q.answer && (
        <div className="flex items-center gap-2 ml-7">
          <SourceIcon source={q.source} />
          <span className="text-sm text-muted-foreground truncate">{q.answer}</span>
        </div>
      )}

      {expanded && (
        <div className="ml-7 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Answer
            </label>
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Enter the answer to use for this question..."
              className="min-h-[80px] text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Note (optional)
            </label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. 'Yes — US citizen, no sponsorship needed'"
              className="text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => onSave(q.id, answer, note)}
              disabled={!answer.trim()}
            >
              <CheckCircle2 className="w-3 h-3 mr-1.5" />
              Save Answer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(q.id)}
            >
              <Trash2 className="w-3 h-3 mr-1.5" />
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Questions() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "review" | "answered">("review");

  const statsQ = useQuery<QStats>({
    queryKey: ["questions-stats"],
    queryFn: () => fetch(`${API}/questions/stats`).then((r) => r.json()),
    refetchInterval: 30_000,
  });

  const questionsQ = useQuery<QuestionEntry[]>({
    queryKey: ["questions", filter],
    queryFn: () => {
      const url =
        filter === "review"
          ? `${API}/questions/review`
          : filter === "answered"
          ? `${API}/questions?needsReview=false`
          : `${API}/questions`;
      return fetch(url).then((r) => r.json());
    },
    refetchInterval: 30_000,
  });

  const saveMut = useMutation({
    mutationFn: ({ id, answer, note }: { id: number; answer: string; note: string }) =>
      fetch(`${API}/questions/${id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer, note }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["questions"] });
      qc.invalidateQueries({ queryKey: ["questions-stats"] });
      toast({ title: "Answer saved", description: "This answer will be reused for similar questions." });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      fetch(`${API}/questions/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["questions"] });
      qc.invalidateQueries({ queryKey: ["questions-stats"] });
      toast({ title: "Question removed" });
    },
  });

  const stats = statsQ.data;
  const questions = questionsQ.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Question Bank</h1>
          <p className="text-muted-foreground text-sm mt-1">
            ATS screening questions encountered during applications. Answer them once — the bot reuses your answers.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ["questions"] });
            qc.invalidateQueries({ queryKey: ["questions-stats"] });
          }}
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold">{stats?.total ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Total questions</div>
          </CardContent>
        </Card>
        <Card className="border-yellow-500/40">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-yellow-400">{stats?.needsReview ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Need your review</div>
          </CardContent>
        </Card>
        <Card className="border-green-500/40">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-green-400">{stats?.answered ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Answered & ready</div>
          </CardContent>
        </Card>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {(["review", "answered", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              filter === f
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "review" ? `Needs Review${stats?.needsReview ? ` (${stats.needsReview})` : ""}` :
             f === "answered" ? "Answered" : "All"}
          </button>
        ))}
      </div>

      {/* Questions list */}
      <div className="space-y-3">
        {questionsQ.isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading questions…</div>
        ) : questions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <HelpCircle className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground">
                {filter === "review"
                  ? "No questions need review — the bot has answered everything it could."
                  : "No questions in this category yet."}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Questions appear here automatically as the bot encounters them during applications.
              </p>
            </CardContent>
          </Card>
        ) : (
          questions.map((q) => (
            <QuestionRow
              key={q.id}
              q={q}
              onSave={(id, answer, note) => saveMut.mutate({ id, answer, note })}
              onDelete={(id) => deleteMut.mutate(id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
