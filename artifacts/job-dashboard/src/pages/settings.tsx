import { useState, useEffect } from "react";
import {
  useGetSettings,
  useUpdateSettings,
  getGetSettingsQueryKey,
  useGetResume,
  getGetResumeQueryKey,
  useListProxies,
  useCreateProxy,
  useUpdateProxy,
  useDeleteProxy,
  useTestProxy,
  useGetProxyRotationSettings,
  useUpdateProxyRotationSettings,
  getListProxiesQueryKey,
  getGetProxyRotationSettingsQueryKey,
  useGetGreenhouseCompanies,
  useAddGreenhouseCompany,
  useRemoveGreenhouseCompany,
  getGetGreenhouseCompaniesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Wifi,
  WifiOff,
  RefreshCw,
  Shield,
  ChevronDown,
  ChevronUp,
  Building2,
  X,
  Mail,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const emailImportSchema = z.object({
  imapGmailEmail: z.string().email().or(z.literal("")).optional(),
  imapGmailAppPassword: z.string().optional(),
  imapYahooEmail: z.string().email().or(z.literal("")).optional(),
  imapYahooAppPassword: z.string().optional(),
});
type EmailImportFormValues = z.infer<typeof emailImportSchema>;

const settingsSchema = z.object({
  contactEmail: z.string().email().or(z.literal("")).optional(),
  contactPhone: z.string().optional(),
  keywords: z.string().transform((str) => str.split(",").map((s) => s.trim()).filter(Boolean)),
  avoidKeywords: z.string().transform((str) => str.split(",").map((s) => s.trim()).filter(Boolean)),
  locationPreference: z.string().min(1),
  dailyLimit: z.coerce.number().min(1).max(200),
  openaiApiKey: z.string().optional(),
  linkedinEmail: z.string().email().or(z.literal("")),
  linkedinPassword: z.string().optional(),
  indeedEmail: z.string().email().or(z.literal("")),
  indeedPassword: z.string().optional(),
  handshakeAsuEmail: z.string().email().or(z.literal("")).optional(),
  handshakeAsuPassword: z.string().optional(),
  enableLinkedin: z.boolean(),
  enableIndeed: z.boolean(),
  enableGreenhouse: z.boolean(),
  enableLever: z.boolean(),
  enableHandshake: z.boolean(),
  enableResumeTailoring: z.boolean(),
  scheduledTime: z.string(),
});

type SettingsFormValues = z.input<typeof settingsSchema>;

const proxyFormSchema = z.object({
  label: z.string().optional(),
  host: z.string().min(1, "Host is required"),
  port: z.string().min(1, "Port is required").regex(/^\d+$/, "Must be a number"),
  protocol: z.enum(["http", "https", "socks5"]),
  username: z.string().optional(),
  password: z.string().optional(),
  enabled: z.boolean(),
});
type ProxyFormValues = z.infer<typeof proxyFormSchema>;

function ProxyStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <Badge variant="outline" className="text-xs">Untested</Badge>;
  if (status === "ok") return (
    <Badge className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-200 dark:border-emerald-800 dark:text-emerald-400">
      <CheckCircle2 className="w-3 h-3 mr-1" /> Live
    </Badge>
  );
  return (
    <Badge className="text-xs bg-red-500/10 text-red-600 border-red-200 dark:border-red-800 dark:text-red-400">
      <WifiOff className="w-3 h-3 mr-1" /> Failed
    </Badge>
  );
}

function AddProxyDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const createProxy = useCreateProxy();
  const { toast } = useToast();

  const form = useForm<ProxyFormValues>({
    resolver: zodResolver(proxyFormSchema),
    defaultValues: {
      label: "",
      host: "",
      port: "",
      protocol: "http",
      username: "",
      password: "",
      enabled: true,
    },
  });

  const onSubmit = (data: ProxyFormValues) => {
    createProxy.mutate(
      {
        data: {
          label: data.label || undefined,
          host: data.host,
          port: data.port,
          protocol: data.protocol,
          username: data.username || undefined,
          password: data.password || undefined,
          enabled: data.enabled,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Proxy added" });
          setOpen(false);
          form.reset();
          onSaved();
        },
        onError: () => toast({ title: "Failed to add proxy", variant: "destructive" }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="button-add-proxy">
          <Plus className="w-4 h-4 mr-2" /> Add Proxy
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Proxy</DialogTitle>
          <DialogDescription>Enter the proxy server details. Supports HTTP, HTTPS, and SOCKS5.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Label (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. US-East-1" data-testid="input-proxy-label" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="protocol"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Protocol</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-proxy-protocol">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="http">HTTP</SelectItem>
                        <SelectItem value="https">HTTPS</SelectItem>
                        <SelectItem value="socks5">SOCKS5</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="host"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Host / IP</FormLabel>
                    <FormControl>
                      <Input placeholder="192.168.1.1 or proxy.example.com" data-testid="input-proxy-host" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="port"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Port</FormLabel>
                  <FormControl>
                    <Input placeholder="8080" data-testid="input-proxy-port" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <button
              type="button"
              onClick={() => setShowAuth(!showAuth)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-toggle-auth"
            >
              {showAuth ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Authentication (optional)
            </button>

            {showAuth && (
              <div className="grid grid-cols-2 gap-3 pl-2 border-l-2 border-muted">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input data-testid="input-proxy-username" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" data-testid="input-proxy-password" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            )}

            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <FormLabel className="text-sm">Enable immediately</FormLabel>
                    <FormDescription className="text-xs">Include this proxy in the rotation pool.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-proxy-enabled" />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createProxy.isPending} data-testid="button-save-proxy">
                {createProxy.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Proxy
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ProxyRow({ proxy, onRefresh }: {
  proxy: { id: number; label?: string | null; host: string; port: string; protocol: string; username?: string | null; enabled: boolean; lastTestStatus?: string | null; lastTestedAt?: string | null };
  onRefresh: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latencyMs?: number | null; ip?: string | null } | null>(null);
  const testProxy = useTestProxy();
  const updateProxy = useUpdateProxy();
  const deleteProxy = useDeleteProxy();
  const { toast } = useToast();

  const handleTest = () => {
    setTesting(true);
    setTestResult(null);
    testProxy.mutate(
      { id: proxy.id },
      {
        onSuccess: (result) => {
          setTestResult(result);
          onRefresh();
        },
        onError: () => toast({ title: "Test request failed", variant: "destructive" }),
        onSettled: () => setTesting(false),
      }
    );
  };

  const handleToggle = (enabled: boolean) => {
    updateProxy.mutate(
      { id: proxy.id, data: { host: proxy.host, port: proxy.port, enabled } },
      { onSuccess: onRefresh, onError: () => toast({ title: "Update failed", variant: "destructive" }) }
    );
  };

  const handleDelete = () => {
    deleteProxy.mutate(
      { id: proxy.id },
      { onSuccess: onRefresh, onError: () => toast({ title: "Delete failed", variant: "destructive" }) }
    );
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-card" data-testid={`row-proxy-${proxy.id}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium truncate text-foreground" data-testid={`text-proxy-address-${proxy.id}`}>
            {proxy.protocol}://{proxy.host}:{proxy.port}
          </span>
          {proxy.label && (
            <Badge variant="secondary" className="text-xs shrink-0">{proxy.label}</Badge>
          )}
          <ProxyStatusBadge status={proxy.lastTestStatus} />
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          {proxy.username && <span>Auth: {proxy.username}</span>}
          {proxy.lastTestedAt && (
            <span>Tested {new Date(proxy.lastTestedAt).toLocaleDateString()}</span>
          )}
          {testResult && (
            <span className={testResult.success ? "text-emerald-600" : "text-red-500"}>
              {testResult.success
                ? `${testResult.latencyMs}ms${testResult.ip ? ` · IP: ${testResult.ip}` : ""}`
                : testResult.message}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Switch
          checked={proxy.enabled}
          onCheckedChange={handleToggle}
          disabled={updateProxy.isPending}
          data-testid={`switch-proxy-toggle-${proxy.id}`}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testing}
          data-testid={`button-test-proxy-${proxy.id}`}
        >
          {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
          <span className="ml-1.5 hidden sm:inline">Test</span>
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-red-500" data-testid={`button-delete-proxy-${proxy.id}`}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove proxy?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove {proxy.host}:{proxy.port} from your rotation pool.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function ProxiesTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: proxies = [], isLoading } = useListProxies();
  const { data: rotation } = useGetProxyRotationSettings();
  const updateRotation = useUpdateProxyRotationSettings();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListProxiesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetProxyRotationSettingsQueryKey() });
  };

  const handleRotationToggle = (enabled: boolean) => {
    updateRotation.mutate(
      { data: { enabled } },
      {
        onSuccess: refresh,
        onError: () => toast({ title: "Failed to update rotation", variant: "destructive" }),
      }
    );
  };

  const handleStrategyChange = (strategy: "round-robin" | "random" | "least-used") => {
    updateRotation.mutate(
      { data: { strategy } },
      { onSuccess: refresh, onError: () => toast({ title: "Update failed", variant: "destructive" }) }
    );
  };

  const handleRotateEveryChange = (val: string) => {
    const n = parseInt(val, 10);
    if (!isNaN(n) && n > 0) {
      updateRotation.mutate(
        { data: { rotateEvery: n } },
        { onSuccess: refresh, onError: () => toast({ title: "Update failed", variant: "destructive" }) }
      );
    }
  };

  const enabledCount = proxies.filter((p) => p.enabled).length;

  return (
    <div className="space-y-4 pt-4">
      {/* Rotation control */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                Proxy Rotation
              </CardTitle>
              <CardDescription className="mt-1">
                Route automation traffic through rotating IPs to reduce platform detection.
              </CardDescription>
            </div>
            <Switch
              checked={rotation?.enabled ?? false}
              onCheckedChange={handleRotationToggle}
              disabled={updateRotation.isPending || enabledCount === 0}
              data-testid="switch-proxy-rotation"
            />
          </div>
        </CardHeader>
        {rotation?.enabled && (
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-0">
            <div className="space-y-2">
              <Label className="text-sm">Rotation Strategy</Label>
              <Select
                value={rotation.strategy}
                onValueChange={(v) => handleStrategyChange(v as "round-robin" | "random" | "least-used")}
              >
                <SelectTrigger data-testid="select-rotation-strategy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="round-robin">Round Robin</SelectItem>
                  <SelectItem value="random">Random</SelectItem>
                  <SelectItem value="least-used">Least Used</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Rotate Every (requests)</Label>
              <Input
                type="number"
                min={1}
                defaultValue={rotation.rotateEvery}
                onBlur={(e) => handleRotateEveryChange(e.target.value)}
                className="w-full"
                data-testid="input-rotate-every"
              />
            </div>
          </CardContent>
        )}
        {enabledCount === 0 && (
          <CardContent className="pt-0">
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Add at least one enabled proxy below to activate rotation.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Proxy list */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Proxy Pool</CardTitle>
              <CardDescription>
                {proxies.length === 0
                  ? "No proxies configured."
                  : `${enabledCount} of ${proxies.length} active`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={refresh}
                data-testid="button-refresh-proxies"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
              <AddProxyDialog onSaved={refresh} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : proxies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground space-y-2">
              <Shield className="w-10 h-10 opacity-20" />
              <p className="text-sm font-medium">No proxies added yet</p>
              <p className="text-xs max-w-xs">
                Add rotating proxy IPs to make automation traffic appear from different locations,
                reducing the chance of LinkedIn or Indeed flagging your account.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {proxies.map((proxy) => (
                <ProxyRow key={proxy.id} proxy={proxy} onRefresh={refresh} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tips */}
      <Card className="border-dashed">
        <CardContent className="pt-4">
          <h4 className="text-sm font-semibold mb-2">Proxy tips</h4>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>Residential proxies work best for LinkedIn — datacenter IPs are often blocked.</li>
            <li>Use SOCKS5 for better compatibility with Playwright browser automation.</li>
            <li>Rotate every 5–10 requests to stay under radar. Very frequent rotation can cause CAPTCHAs.</li>
            <li>Click "Test" to verify a proxy is reachable before enabling rotation.</li>
            <li>Proxies with authentication are supported — enter credentials when adding.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function PlatformLoginButton({ platform, label }: { platform: "linkedin" | "indeed"; label: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    toast({ title: `${label}: browser window opening — complete login and any MFA there` });
    try {
      const res = await fetch(`/api/auth/${platform}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: `${label}: session saved successfully ✓` });
      } else {
        toast({ title: `${label}: login failed — ${body.message ?? "unknown error"}`, variant: "destructive" });
      }
    } catch (err) {
      toast({ title: `${label}: ${String(err)}`, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleLogin} disabled={loading}>
      {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
      {loading ? "Waiting for login…" : `Login to ${label}`}
    </Button>
  );
}

function LinkedInLoginButton() { return <PlatformLoginButton platform="linkedin" label="LinkedIn" />; }
function IndeedLoginButton() { return <PlatformLoginButton platform="indeed" label="Indeed" />; }

export function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading: loadingSettings } = useGetSettings();
  const { data: resume } = useGetResume();
  const updateSettings = useUpdateSettings();

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      contactEmail: "",
      contactPhone: "",
      keywords: "",
      avoidKeywords: "",
      locationPreference: "",
      dailyLimit: 100,
      openaiApiKey: "",
      linkedinEmail: "",
      linkedinPassword: "",
      indeedEmail: "",
      indeedPassword: "",
      handshakeAsuEmail: "",
      handshakeAsuPassword: "",
      enableLinkedin: true,
      enableIndeed: true,
      enableGreenhouse: true,
      enableLever: true,
      enableHandshake: false,
      enableResumeTailoring: false,
      scheduledTime: "08:00",
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        contactEmail: settings.contactEmail || "",
        contactPhone: settings.contactPhone || "",
        keywords: settings.keywords?.join(", ") || "",
        avoidKeywords: settings.avoidKeywords?.join(", ") || "",
        locationPreference: settings.locationPreference || "",
        dailyLimit: settings.dailyLimit || 100,
        openaiApiKey: settings.openaiApiKey || "",
        linkedinEmail: settings.linkedinEmail || "",
        linkedinPassword: settings.linkedinPassword || "",
        indeedEmail: settings.indeedEmail || "",
        indeedPassword: settings.indeedPassword || "",
        handshakeAsuEmail: settings.handshakeAsuEmail || "",
        handshakeAsuPassword: settings.handshakeAsuPassword || "",
        enableLinkedin: settings.enableLinkedin ?? true,
        enableIndeed: settings.enableIndeed ?? true,
        enableGreenhouse: settings.enableGreenhouse ?? true,
        enableLever: settings.enableLever ?? true,
        enableHandshake: settings.enableHandshake ?? false,
        enableResumeTailoring: settings.enableResumeTailoring ?? false,
        scheduledTime: settings.scheduledTime || "08:00",
      });
    }
  }, [settings, form]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onSubmit = (data: any) => {
    const payload = { ...data };
    if (!payload.linkedinPassword) delete payload.linkedinPassword;
    if (!payload.indeedPassword) delete payload.indeedPassword;
    if (!payload.openaiApiKey) delete payload.openaiApiKey;

    updateSettings.mutate(
      { data: payload },
      {
        onSuccess: () => {
          toast({ title: "Settings saved" });
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
        onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
      }
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.includes("pdf") && !file.name.endsWith(".docx")) {
      toast({ title: "Only PDF or DOCX files are supported", variant: "destructive" });
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const interval = setInterval(() => setUploadProgress((p) => Math.min(p + 12, 88)), 200);
      const res = await fetch("/api/resume/upload", { method: "POST", body: formData });
      clearInterval(interval);
      setUploadProgress(100);

      if (res.ok) {
        toast({ title: "Resume uploaded and parsed" });
        queryClient.invalidateQueries({ queryKey: getGetResumeQueryKey() });
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || "Upload failed");
      }
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setTimeout(() => { setUploading(false); setUploadProgress(0); }, 600);
    }
  };

  if (loadingSettings) {
    return (
      <div className="flex h-[50vh] justify-center items-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
        <p className="text-muted-foreground">Manage your resume, credentials, proxies, and search parameters.</p>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="flex flex-wrap gap-1 h-auto md:w-auto">
          <TabsTrigger value="general" data-testid="tab-general">General</TabsTrigger>
          <TabsTrigger value="resume" data-testid="tab-resume">Resume</TabsTrigger>
          <TabsTrigger value="credentials" data-testid="tab-credentials">Credentials</TabsTrigger>
          <TabsTrigger value="ai" data-testid="tab-ai">AI Setup</TabsTrigger>
          <TabsTrigger value="proxies" data-testid="tab-proxies">Proxies</TabsTrigger>
          <TabsTrigger value="greenhouse" data-testid="tab-greenhouse">Greenhouse</TabsTrigger>
          <TabsTrigger value="email" data-testid="tab-email">Email Import</TabsTrigger>
        </TabsList>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            {/* GENERAL */}
            <TabsContent value="general" className="space-y-4 pt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Contact Info Override</CardTitle>
                  <CardDescription>Override the email/phone extracted from your resume. Leave blank to use what's in your resume.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="contactEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="your@email.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="contactPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Phone</FormLabel>
                        <FormControl>
                          <Input placeholder="+1 555-555-5555" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Search Parameters</CardTitle>
                  <CardDescription>Define what jobs the engine should target.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="keywords"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Job Keywords (comma separated)</FormLabel>
                        <FormControl>
                          <Input placeholder="data analyst, data scientist, analytics engineer" data-testid="input-keywords" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="avoidKeywords"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Avoid Keywords <span className="text-xs font-normal text-muted-foreground">(comma separated — jobs matching these titles are skipped)</span></FormLabel>
                        <FormControl>
                          <Input placeholder="senior, lead, principal, staff, director, manager" data-testid="input-avoid-keywords" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="locationPreference"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Location <span className="text-xs font-normal text-muted-foreground">(US only)</span></FormLabel>
                          <FormControl>
                            <Input placeholder="Remote or San Francisco, CA" data-testid="input-location" {...field} />
                          </FormControl>
                          <FormDescription className="text-xs">Country is always locked to United States — non-US jobs are filtered automatically.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="dailyLimit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Daily Application Limit</FormLabel>
                          <FormControl>
                            <Input type="number" data-testid="input-daily-limit" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="scheduledTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Daily Run Time</FormLabel>
                        <FormControl>
                          <Input type="time" data-testid="input-scheduled-time" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Platforms</CardTitle>
                  <CardDescription>Enable or disable specific job boards.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(
                      [
                        ["enableLinkedin", "LinkedIn"],
                        ["enableIndeed", "Indeed"],
                        ["enableGreenhouse", "Greenhouse"],
                        ["enableLever", "Lever"],
                        ["enableHandshake", "Handshake (ASU)"],
                      ] as const
                    ).map(([name, label]) => (
                      <FormField
                        key={name}
                        control={form.control}
                        name={name}
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <FormLabel className="text-base cursor-pointer">{label}</FormLabel>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                data-testid={`switch-${name}`}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button type="submit" disabled={updateSettings.isPending} size="lg" data-testid="button-save-settings">
                  {updateSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Configuration
                </Button>
              </div>
            </TabsContent>

            {/* RESUME */}
            <TabsContent value="resume" className="space-y-4 pt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Master Resume</CardTitle>
                  <CardDescription>Upload your base resume. The system extracts structured data for auto-filling forms.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {resume ? (
                    <div className="flex items-start gap-4 p-4 border rounded-lg bg-muted/20" data-testid="status-resume-uploaded">
                      <div className="p-3 bg-primary/10 text-primary rounded-full">
                        <FileText className="w-6 h-6" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-semibold" data-testid="text-resume-name">
                          {(resume.parsedJson as { name?: string })?.name ?? "Resume Parsed"}
                        </h4>
                        <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-2">
                          {(resume.parsedJson as { email?: string })?.email && (
                            <span data-testid="text-resume-email">{(resume.parsedJson as { email?: string }).email}</span>
                          )}
                          {(resume.parsedJson as { phone?: string })?.phone && (
                            <span>· {(resume.parsedJson as { phone?: string }).phone}</span>
                          )}
                        </div>
                        <div className="mt-3 flex gap-2 flex-wrap">
                          <Badge variant="secondary" data-testid="badge-skills-count">
                            {(resume.parsedJson as { skills?: unknown[] })?.skills?.length ?? 0} Skills
                          </Badge>
                          <Badge variant="secondary" data-testid="badge-experience-count">
                            {(resume.parsedJson as { experience?: unknown[] })?.experience?.length ?? 0} Roles
                          </Badge>
                          {(resume.parsedJson as { education?: unknown[] })?.education?.length ? (
                            <Badge variant="secondary">
                              {(resume.parsedJson as { education?: unknown[] }).education!.length} Education
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 p-4 border border-amber-200 bg-amber-50 text-amber-800 rounded-lg dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <p className="text-sm font-medium">No resume uploaded. Upload one below so the engine can auto-fill application forms.</p>
                    </div>
                  )}

                  <div className="space-y-3">
                    <Label>Upload Resume (PDF or DOCX)</Label>
                    <Input
                      type="file"
                      accept=".pdf,.docx"
                      className="cursor-pointer"
                      onChange={handleFileUpload}
                      disabled={uploading}
                      data-testid="input-resume-file"
                    />
                    {uploading && (
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Uploading and parsing...</span>
                          <span>{uploadProgress}%</span>
                        </div>
                        <Progress value={uploadProgress} className="h-1.5" />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* CREDENTIALS */}
            <TabsContent value="credentials" className="space-y-4 pt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Platform Credentials</CardTitle>
                  <CardDescription>Required for automated logins on gated platforms. Stored securely in your database.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* LinkedIn */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b pb-2">
                      <h3 className="font-semibold">LinkedIn</h3>
                      <LinkedInLoginButton />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="linkedinEmail"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input placeholder="your@email.com" data-testid="input-linkedin-email" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="linkedinPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Password</FormLabel>
                            <FormControl>
                              <Input
                                type="password"
                                placeholder={(settings as any)?.linkedinPassword ? "Saved — enter new to change" : "Enter password"}
                                data-testid="input-linkedin-password"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Save credentials above first, then click "Login to LinkedIn" to open a browser window and complete any MFA. The session is saved automatically.</p>
                  </div>

                  {/* Indeed */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b pb-2">
                      <h3 className="font-semibold">Indeed</h3>
                      <IndeedLoginButton />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="indeedEmail"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input placeholder="your@email.com" data-testid="input-indeed-email" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="indeedPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Password</FormLabel>
                            <FormControl>
                              <Input
                                type="password"
                                placeholder={(settings as any)?.indeedPassword ? "Saved — enter new to change" : "Enter password"}
                                data-testid="input-indeed-password"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Click "Login to Indeed" to open a browser window. Complete login and any MFA — the session is saved automatically.</p>
                  </div>

                  {/* Handshake (ASU) */}
                  <div className="space-y-3">
                    <h3 className="font-semibold border-b pb-2 flex items-center gap-2">
                      Handshake (ASU)
                      <Badge variant="secondary" className="text-xs">ASU SSO</Badge>
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Used to log into <code>asu.joinhandshake.com</code> via ASU Single Sign-On. Requires Playwright browser automation.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="handshakeAsuEmail"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>ASU Email (ASURITE)</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="username@asu.edu"
                                data-testid="input-handshake-email"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="handshakeAsuPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>ASU Password</FormLabel>
                            <FormControl>
                              <Input
                                type="password"
                                placeholder={settings?.handshakeAsuPassword ? "Saved — enter new to change" : "ASU password"}
                                data-testid="input-handshake-password"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
                      Duo MFA: if a push is required during login, the system will pause and send a dashboard notification for you to approve manually.
                    </p>
                  </div>
                </CardContent>
              </Card>
              <div className="flex justify-end">
                <Button type="submit" disabled={updateSettings.isPending} size="lg" data-testid="button-save-credentials">
                  {updateSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Credentials
                </Button>
              </div>
            </TabsContent>

            {/* AI */}
            <TabsContent value="ai" className="space-y-4 pt-4">
              <Card>
                <CardHeader>
                  <CardTitle>AI Configuration</CardTitle>
                  <CardDescription>Powers cover letter generation and smart answers for custom ATS questions.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="openaiApiKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>OpenAI API Key</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder={settings?.openaiApiKey ? "Saved — enter new to change" : "sk-..."}
                            data-testid="input-openai-key"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Uses gpt-4o-mini for cost efficiency. Cover letters are cached per job so you won't be double-billed.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="enableResumeTailoring"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Auto-generate Cover Letters</FormLabel>
                          <FormDescription>
                            Generate a bespoke cover letter for each queued job before applying. Adds ~2s per application.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-enable-tailoring"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
              <div className="flex justify-end">
                <Button type="submit" disabled={updateSettings.isPending} size="lg" data-testid="button-save-ai">
                  {updateSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save AI Settings
                </Button>
              </div>
            </TabsContent>
          </form>
        </Form>

        {/* PROXIES — outside the form so it has its own state */}
        <TabsContent value="proxies">
          <ProxiesTab />
        </TabsContent>

        {/* GREENHOUSE — outside the form */}
        <TabsContent value="greenhouse">
          <GreenhouseTab />
        </TabsContent>

        {/* EMAIL IMPORT — outside the form */}
        <TabsContent value="email">
          <EmailImportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmailImportTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const [syncing, setSyncing] = useState(false);

  const form = useForm<EmailImportFormValues>({
    resolver: zodResolver(emailImportSchema),
    defaultValues: {
      imapGmailEmail: "",
      imapGmailAppPassword: "",
      imapYahooEmail: "",
      imapYahooAppPassword: "",
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        imapGmailEmail: settings.imapGmailEmail || "",
        imapGmailAppPassword: settings.imapGmailAppPassword || "",
        imapYahooEmail: settings.imapYahooEmail || "",
        imapYahooAppPassword: settings.imapYahooAppPassword || "",
      });
    }
  }, [settings, form]);

  const onSubmit = (data: EmailImportFormValues) => {
    updateSettings.mutate(
      { data: data as any },
      {
        onSuccess: () => {
          toast({ title: "Email import settings saved" });
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
        onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
      }
    );
  };

  const handleSync = async () => {
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
      toast({
        title: parts.length ? parts.join(". ") + "." : "Email sync complete — no changes found.",
      });
    } catch (err) {
      toast({
        title: "Email sync failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />
            Email Import & Status Sync
          </CardTitle>
          <CardDescription>
            Connect Gmail or Yahoo Mail via IMAP to import past applications and auto-update statuses
            from rejection, interview, and offer emails.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Gmail */}
              <div className="space-y-3">
                <h3 className="font-semibold border-b pb-2">Gmail</h3>
                <p className="text-xs text-muted-foreground">
                  Use an <a className="underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">App Password</a> (not your regular password). Enable IMAP in Gmail settings first.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="imapGmailEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Gmail Address</FormLabel>
                        <FormControl>
                          <Input placeholder="you@gmail.com" data-testid="input-imap-gmail-email" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="imapGmailAppPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Gmail App Password</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder={settings?.imapGmailAppPassword ? "Saved — enter new to change" : "xxxx xxxx xxxx xxxx"}
                            data-testid="input-imap-gmail-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Yahoo */}
              <div className="space-y-3">
                <h3 className="font-semibold border-b pb-2">Yahoo Mail</h3>
                <p className="text-xs text-muted-foreground">
                  Generate an app password at <span className="font-mono text-xs">Account Security → Generate app password</span> in Yahoo settings.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="imapYahooEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Yahoo Email</FormLabel>
                        <FormControl>
                          <Input placeholder="you@yahoo.com" data-testid="input-imap-yahoo-email" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="imapYahooAppPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Yahoo App Password</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder={settings?.imapYahooAppPassword ? "Saved — enter new to change" : "Enter app password"}
                            data-testid="input-imap-yahoo-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSync}
                  disabled={syncing}
                  data-testid="button-sync-email-settings"
                >
                  {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                  Sync Now
                </Button>
                <Button type="submit" disabled={updateSettings.isPending} data-testid="button-save-email-import">
                  {updateSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Email Settings
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="pt-4">
          <h4 className="text-sm font-semibold mb-2">How email import works</h4>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li><strong>Status sync</strong>: scans your inbox for emails from known companies — classifies rejections, interview requests, and offers using AI.</li>
            <li><strong>Application import</strong>: scans your sent mail for confirmation emails and creates "Manual" application records.</li>
            <li>Status updates never downgrade: offer &gt; interview &gt; applied &gt; rejected.</li>
            <li>Runs automatically at the end of every scheduled pipeline run.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function GreenhouseTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetGreenhouseCompanies();
  const addCompany = useAddGreenhouseCompany();
  const removeCompany = useRemoveGreenhouseCompany();

  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");

  const companies = data?.companies ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetGreenhouseCompaniesQueryKey() });

  const handleAdd = () => {
    const slug = newSlug.trim().toLowerCase().replace(/\s+/g, "-");
    const name = newName.trim();
    if (!slug || !name) {
      toast({ title: "Slug and name are required", variant: "destructive" });
      return;
    }
    addCompany.mutate(
      { data: { slug, name } },
      {
        onSuccess: () => {
          toast({ title: `Added ${name}` });
          setNewSlug("");
          setNewName("");
          refresh();
        },
        onError: () => toast({ title: "Failed to add company (slug may already exist)", variant: "destructive" }),
      }
    );
  };

  const handleRemove = (slug: string, name: string) => {
    removeCompany.mutate(
      { slug },
      {
        onSuccess: () => {
          toast({ title: `Removed ${name}` });
          refresh();
        },
        onError: () => toast({ title: "Failed to remove company", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            Greenhouse Company Seed List
          </CardTitle>
          <CardDescription>
            The engine checks each company's public Greenhouse API for matching jobs.
            Currently tracking <strong>{companies.length}</strong> companies.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add new */}
          <div className="flex gap-2">
            <Input
              placeholder="Company slug (e.g. stripe)"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              className="flex-1"
              data-testid="input-greenhouse-slug"
            />
            <Input
              placeholder="Display name (e.g. Stripe)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1"
              data-testid="input-greenhouse-name"
            />
            <Button onClick={handleAdd} disabled={addCompany.isPending} size="sm">
              {addCompany.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </Button>
          </div>

          {/* Company list */}
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="border rounded-lg divide-y max-h-[480px] overflow-y-auto">
              {companies.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">No companies in seed list.</div>
              ) : (
                companies.map((c) => (
                  <div key={c.slug} className="flex items-center justify-between px-3 py-2">
                    <div>
                      <span className="font-medium text-sm">{c.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">/{c.slug}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-red-500 h-7 w-7 p-0"
                      onClick={() => handleRemove(c.slug, c.name)}
                      disabled={removeCompany.isPending}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="pt-4">
          <h4 className="text-sm font-semibold mb-2">How Greenhouse scraping works</h4>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>The engine queries <code>boards-api.greenhouse.io/v1/boards/&lt;slug&gt;/jobs</code> — no login needed.</li>
            <li>Only jobs with titles matching your keywords and US locations are queued.</li>
            <li>Applications go to the company's own careers portal (<code>absolute_url</code>), not Greenhouse's board.</li>
            <li>Find a company's slug in their Greenhouse job URL: <code>boards.greenhouse.io/&lt;slug&gt;</code>.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
