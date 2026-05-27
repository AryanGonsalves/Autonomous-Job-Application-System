import { Router, type IRouter } from "express";
import { getGreenhouseCompanies, saveGreenhouseCompanies, type GreenhouseCompany } from "../lib/greenhouse";

const router: IRouter = Router();

router.get("/greenhouse/companies", async (_req, res): Promise<void> => {
  const companies = await getGreenhouseCompanies();
  res.json({ companies });
});

router.put("/greenhouse/companies", async (req, res): Promise<void> => {
  const { companies } = req.body as { companies: GreenhouseCompany[] };
  if (!Array.isArray(companies)) {
    res.status(400).json({ error: "companies must be an array" });
    return;
  }
  await saveGreenhouseCompanies(companies);
  res.json({ companies });
});

router.post("/greenhouse/companies", async (req, res): Promise<void> => {
  const { slug, name } = req.body as { slug: string; name: string };
  if (!slug || !name) {
    res.status(400).json({ error: "slug and name are required" });
    return;
  }
  const current = await getGreenhouseCompanies();
  if (current.some((c) => c.slug === slug)) {
    res.status(409).json({ error: "Company with this slug already exists" });
    return;
  }
  const updated = [...current, { slug, name }];
  await saveGreenhouseCompanies(updated);
  res.status(201).json({ slug, name });
});

router.delete("/greenhouse/companies/:slug", async (req, res): Promise<void> => {
  const { slug } = req.params;
  const current = await getGreenhouseCompanies();
  const updated = current.filter((c) => c.slug !== slug);
  await saveGreenhouseCompanies(updated);
  res.json({ ok: true });
});

export default router;
