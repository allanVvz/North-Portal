"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { PortalPayload } from "@/lib/validation";
import {
  briefSteps,
  checklistItems,
  comoFunciona,
  cronograma,
  deveresCliente,
  deveresNorth,
  folders,
  recomendacoes,
} from "./content";

type SaveChip = "" | "Salvando…" | "Salvo" | "Erro ao salvar" | "Concluído";

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start", inline: "start" });
}

function sectionLabel(id: string): string {
  switch (id) {
    case "sec-manual": return "Manual do cliente";
    case "sec-briefing": return "Briefing";
    case "sec-marca": return "Marca & Produtos";
    case "sec-result": return "Resultados";
    default: return "Capa";
  }
}

export default function ClientPortal() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [payload, setPayload] = useState<PortalPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [chip, setChip] = useState<SaveChip>("");
  const [pageError, setPageError] = useState("");
  const [section, setSection] = useState("sec-hero");
  const [hoverDest, setHoverDest] = useState<CompassPoint | null>(null);

  const loaded = useRef(false);
  const saveSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const deckRef = useRef<HTMLDivElement | null>(null);

  // Track the active section to drive the slim header.
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const ids = ["sec-hero", "sec-manual", "sec-briefing", "sec-marca", "sec-result"];
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const desktop = window.matchMedia("(min-width: 921px)").matches;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && e.intersectionRatio >= 0.5) setSection(e.target.id);
        });
      },
      { root: desktop ? deck : null, threshold: [0.5, 0.75] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pageError]);

  useEffect(() => {
    loaded.current = false;
    abortRef.current?.abort();
    setPageError("");
    setPayload(null);
    setChip("");
    fetch(`/api/client/${slug}`)
      .then(async (response) => {
        if (!response.ok)
          throw new Error(response.status === 404 ? "Cliente não encontrado ou inativo." : "Falha ao carregar o portal.");
        return response.json() as Promise<PortalPayload>;
      })
      .then((data) => {
        setPayload(data);
        setAnswers(data.briefing.answers ?? {});
        setChip(data.briefing.submitted ? "Concluído" : "");
        loaded.current = true;
      })
      .catch((error: Error) => setPageError(error.message));
  }, [slug]);

  // Debounced autosave of the whole briefing answer object.
  useEffect(() => {
    if (!loaded.current) return;
    const currentSeq = ++saveSeq.current;
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setChip("Salvando…");
      try {
        const response = await fetch(`/api/client/${slug}/briefing`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers, submitted: payload?.briefing.submitted ?? false }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("save failed");
        const saved = await response.json();
        if (currentSeq === saveSeq.current) {
          setPayload((current) => (current ? { ...current, briefing: saved } : current));
          setChip(saved.submitted ? "Concluído" : "Salvo");
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError" && currentSeq === saveSeq.current) setChip("Erro ao salvar");
      }
    }, 950);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers]);

  const finishBriefing = useCallback(async () => {
    setChip("Salvando…");
    try {
      const response = await fetch(`/api/client/${slug}/briefing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, submitted: true }),
      });
      if (!response.ok) throw new Error("save failed");
      const saved = await response.json();
      setPayload((current) => (current ? { ...current, briefing: saved } : current));
      setChip("Concluído");
    } catch {
      setChip("Erro ao salvar");
    }
  }, [answers, slug]);

  const setAnswer = useCallback((key: string, value: string) => {
    setAnswers((current) => ({ ...current, [key]: value }));
  }, []);

  if (pageError) {
    return (
      <>
        <div className="topbar" />
        <main className="fatal">
          <p className="eyebrow">Portal North</p>
          <h1 className="title">Portal indisponível.</h1>
          <p className="lead">{pageError}</p>
          <p className="lead">Não foi possível carregar o portal agora. Tente novamente.</p>
        </main>
      </>
    );
  }

  const name = payload?.client.name ?? slug;
  const links = payload?.driveLinks;
  const metrics = payload?.results.topMetrics ?? [];
  const reportUrl = payload?.results.reportUrl ?? null;
  const feedbackUrl = payload?.results.feedbackUrl ?? null;
  const metricsPending = metrics.length === 0;
  const metricSlots: { label: string; value: string; variation?: string; description?: string }[] = metricsPending
    ? [
        { label: "Seguidores", value: "—" },
        { label: "Alcance no período", value: "—" },
        { label: "Leads gerados", value: "—" },
        { label: "Ticket médio", value: "—" },
      ]
    : metrics.slice(0, 4);

  return (
    <>
      <div className="topbar" />
      <header className={`siteheader ${section === "sec-hero" ? "cover" : ""}`}>
        <span className="hbrand">north</span>
        <span className="hsection"><span className="d" />{sectionLabel(section)}</span>
      </header>
      <button
        className={`fab-top ${section === "sec-hero" ? "hide" : ""}`}
        aria-label="Voltar ao topo"
        onClick={() => scrollToId("p-hero")}
      >
        ↑
      </button>

      <div className="deck" ref={deckRef}>
        {/* ============ NÍVEL 00 · CAPA ============ */}
        <section className="row" id="sec-hero">
          <div className="panel" id="p-hero">
            <div className="p-head">
              <span className="p-label">{name}</span>
              <span className="p-label">Menu principal</span>
            </div>
            <div className="p-body">
              <div className={`hero-grid ${hoverDest ? "hovering" : ""}`}>
                <div className="hero-copy">
                  <p className="hero-title">
                    Portal <b>north</b>
                  </p>
                  <p className="hero-lead">
                    Seu projeto com a north, <em>reunido em um só lugar</em>.
                    <br />
                    Gire a <strong>bússola</strong> e escolha por onde começar.
                  </p>
                </div>
                <div className="compass-wrap">
                  <Compass onGo={(t) => scrollToId(t)} onHover={setHoverDest} />
                  <div className="compass-hint" aria-live="polite">
                    {hoverDest ? (
                      <>
                        <span className="sub">{hoverDest.dir}</span>
                        <strong>{hoverDest.dest}</strong>
                      </>
                    ) : (
                      <>
                        <span className="sub">Escolha uma direção</span>
                        <strong className="ghost">A agulha segue você</strong>
                      </>
                    )}
                  </div>
                  <nav className="compass-menu" aria-label="Navegação rápida">
                    {COMPASS_POINTS.map((p) => (
                      <button
                        key={p.key}
                        onMouseEnter={() => setHoverDest(p)}
                        onMouseLeave={() => setHoverDest(null)}
                        onClick={() => scrollToId(p.target)}
                      >
                        <b>{p.key}</b>
                        <span>{p.short}</span>
                      </button>
                    ))}
                  </nav>
                </div>
              </div>
            </div>
            <div className="p-foot">
              <span>north · agência de marketing &amp; tráfego</span>
              <span className="mid">/{slug}</span>
              <span>00 · Capa</span>
            </div>
          </div>
        </section>

        {/* ============ NÍVEL 01 · MANUAL ============ */}
        <section className="row" id="sec-manual">
          <MenuPanel
            id="p-manual"
            label="Portal North · 01"
            eyebrow="Boas-vindas"
            titleA="Bem-"
            titleB="vindo."
            line2="Que bom ter você por aqui."
            lead="Parabéns pela decisão — você deu um passo importante para fortalecer o posicionamento do seu negócio. A partir de agora, nossa equipe assume a produção de conteúdo e a gestão de tráfego do seu perfil. Este manual mostra a jornada completa, do briefing aos resultados."
            cta="Ver o manual completo"
            onCta={() => scrollToId("p-manual-1")}
            index="01 / 04"
            watermark="O"
          />

          {/* 01.1 Checklist */}
          <div className="panel cream" id="p-manual-1">
            <div className="p-head">
              <span className="p-spacer" aria-hidden />
              <span className="p-label">Manual do cliente · 03</span>
            </div>
            <div className="p-body top">
              <div className="sub-title">
                <p className="eyebrow">Antes de começar</p>
                <h2 className="title">
                  Checklist <span className="accent">do cliente</span>
                </h2>
                <p className="lead">Tudo o que precisamos em mãos para colocar a estratégia em movimento.</p>
              </div>
              <div className="grid cols-2" style={{ marginTop: 36 }}>
                {checklistItems.map((item) => (
                  <div className="check-row" key={item}>
                    <span className="tick" aria-hidden>✓</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <SubFoot backTo="p-manual" backLabel="Voltar ao portal" right="Manual · 01 / 05" onRight={() => scrollToId("p-manual-2")} />
          </div>

          {/* 01.2 Como funciona */}
          <div className="panel" id="p-manual-2">
            <SubHead label="Manual do cliente · 02" backTo="p-manual" backLabel="Boas-vindas" />
            <div className="p-body top">
              <SubTitle eyebrow="O processo" titleA="Como vai " titleB="funcionar?" />
              <div className="grid cols-3" style={{ marginTop: 56 }}>
                {comoFunciona.map((s) => (
                  <div key={s.num} style={{ display: "grid", gap: 12 }}>
                    <span className="num" style={{ fontFamily: "Fraunces, serif", fontWeight: 300, fontSize: 46, color: "var(--teal)" }}>{s.num}</span>
                    <h3 className="serif" style={{ margin: 0, fontSize: 26, color: "var(--sand)" }}>{s.title}</h3>
                    <p className="lead" style={{ margin: 0 }}>{s.text}</p>
                  </div>
                ))}
              </div>
              <div className="card" style={{ marginTop: 44 }}>
                <span className="micro">Regras de ouro</span>
                <p style={{ color: "var(--sand)", fontSize: 16 }}>
                  Aprovação em até <strong>1 dia útil</strong> · até <strong>2 rodadas</strong> de ajuste por vídeo.
                </p>
              </div>
            </div>
            <SubFoot backTo="p-manual" backLabel="Boas-vindas" right="Manual · 02 / 05" onRight={() => scrollToId("p-manual-3")} />
          </div>

          {/* 01.3 Cronograma */}
          <div className="panel cream" id="p-manual-3">
            <SubHead label="Manual do cliente · 03" backTo="p-manual" backLabel="Boas-vindas" />
            <div className="p-body top">
              <SubTitle eyebrow="As primeiras quatro semanas" titleA="Cronograma " titleB="do primeiro mês" />
              <div className="grid cols-4" style={{ gridTemplateColumns: "repeat(5, minmax(0,1fr))", marginTop: 64 }}>
                {cronograma.map((c) => (
                  <div key={c.week} style={{ display: "grid", gap: 14 }}>
                    <span className="serif" style={{ fontSize: 34, color: "var(--ink)" }}>{c.week}</span>
                    <span style={{ height: 1, background: "var(--line-cream)", position: "relative" }}>
                      <i style={{ position: "absolute", left: 0, top: -4, width: 9, height: 9, borderRadius: "50%", background: "var(--teal-deep)" }} />
                    </span>
                    <p style={{ margin: 0, color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.5 }}>{c.text}</p>
                  </div>
                ))}
              </div>
            </div>
            <SubFoot backTo="p-manual" backLabel="Boas-vindas" right="Manual · 03 / 05" onRight={() => scrollToId("p-manual-4")} cream />
          </div>

          {/* 01.4 Recomendações */}
          <div className="panel" id="p-manual-4">
            <SubHead label="Manual do cliente · 04" backTo="p-manual" backLabel="Boas-vindas" />
            <div className="p-body top">
              <SubTitle eyebrow="Para ir mais longe" titleA="Recomendações de " titleB="sucesso" />
              <p className="lead" style={{ marginTop: 18, marginBottom: 40 }}>
                Pequenos hábitos do seu lado que multiplicam os resultados do nosso trabalho.
              </p>
              <div className="grid cols-3">
                {recomendacoes.map((r) => (
                  <div className="card" key={r.num}>
                    <span className="num">{r.num}</span>
                    <h3>{r.title}</h3>
                    <p>{r.text}</p>
                  </div>
                ))}
              </div>
            </div>
            <SubFoot backTo="p-manual" backLabel="Boas-vindas" right="Manual · 04 / 05" onRight={() => scrollToId("p-manual-5")} />
          </div>

          {/* 01.5 Deveres */}
          <div className="panel" id="p-manual-5">
            <SubHead label="Manual do cliente · 05" backTo="p-manual" backLabel="Boas-vindas" />
            <div className="p-body top">
              <SubTitle eyebrow="Quem cuida de quê" titleA="Deveres da " titleB="parceria" />
              <div className="grid cols-3" style={{ marginTop: 48 }}>
                <div>
                  <span className="micro" style={{ color: "var(--eyebrow)" }}>Equipe north</span>
                  <ul className="qlist" style={{ marginTop: 16 }}>
                    {deveresNorth.map((d) => <li key={d}>{d}</li>)}
                  </ul>
                </div>
                <div>
                  <span className="micro" style={{ color: "var(--eyebrow)" }}>Cliente</span>
                  <ul className="qlist" style={{ marginTop: 16 }}>
                    {deveresCliente.map((d) => <li key={d}>{d}</li>)}
                  </ul>
                </div>
                <div className="card">
                  <span className="micro">Horário de atendimento</span>
                  <h3>Pelo WhatsApp, segunda a sexta · das 8h às 18h.</h3>
                  <span className="micro" style={{ marginTop: 8 }}>Prazos, limites e extras</span>
                  <p>
                    Aprovação dos conteúdos em até <strong>1 dia útil</strong>. Até <strong>2 rodadas</strong> de alteração
                    por vídeo. Reúna todas as observações em um único retorno.
                  </p>
                  <p className="accent" style={{ fontSize: 14 }}>
                    Urgência permanente não substitui planejamento — o ritmo combinado protege a qualidade.
                  </p>
                </div>
              </div>
            </div>
            <SubFoot backTo="p-manual" backLabel="Boas-vindas" right="Manual · 05 / 05" onRight={() => scrollToId("p-hero")} />
          </div>
        </section>

        {/* ============ NÍVEL 02 · BRIEFING ============ */}
        <section className="row" id="sec-briefing">
          <MenuPanel
            id="p-briefing"
            label="Portal North · 02 / 04"
            eyebrow="Etapa 02 · Briefing"
            titleA="O briefing molda a "
            titleB="estratégia."
            lead="Quanto mais completo o briefing, mais certeira fica a estratégia. Responda o formulário e nos conte o contexto do seu negócio, seus objetivos e sua rotina."
            cta="Abrir formulário de briefing"
            onCta={() => scrollToId("p-brief-cafe")}
            index="02 / 04"
            watermark="L"
          />

          {/* 02.0 Pausa para o café */}
          <div className="panel" id="p-brief-cafe">
            <div className="p-head">
              <span className="p-spacer" aria-hidden />
              <span className="p-label">Briefing · Preparação</span>
            </div>
            <div className="p-body">
              <div className="cafe-grid">
                <div>
                  <p className="eyebrow">Etapa 02 · Briefing</p>
                  <h1 className="title">
                    Pegue um café.
                    <br />
                    <span className="accent">Vamos dar forma à sua marca.</span>
                  </h1>
                  <p className="lead">
                    Reserve alguns minutos para contar o que move o seu negócio, seus objetivos e a rotina da operação.
                    Quanto mais completas as respostas, mais fiel será a leitura do DNA da marca.
                  </p>
                </div>
                <div className="cafe-card">
                  <CoffeeCup />
                  <h3 className="serif">Pausa para o café.</h3>
                  <p>Respire fundo. As próximas telas são um bate-papo sobre o seu negócio — sem pressa.</p>
                  <div className="cta-row">
                    <button className="btn solid lg" onClick={() => scrollToId("p-brief-1")}>Começar o briefing →</button>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-foot">
              <span>north · agência de marketing &amp; tráfego</span>
              <button className="foot-link top-link" onClick={() => scrollToId("p-hero")}>Retornar para o topo ↑</button>
              <span>Início do briefing</span>
            </div>
          </div>

          {briefSteps.map((step, i) => {
            const n = i + 1;
            const isLast = n === briefSteps.length;
            return (
              <div className="panel cream" id={`p-brief-${n}`} key={step.cards[0].key}>
                <div className="p-head">
                  <span className="p-spacer" aria-hidden />
                  <span className="p-label">Briefing · {String(n).padStart(2, "0")} / 12</span>
                </div>
                <div className="p-body top">
                  <div className="brief-wrap">
                    <div className="brief-titlerow">
                      <p className="eyebrow">
                        {step.eyebrow}
                        {chip ? <span className={`save-status ${chip === "Erro ao salvar" ? "err" : ""}`}> · {chip}</span> : null}
                      </p>
                      <h2 className="title">
                        {step.titleA}
                        <span className="accent">{step.titleB}</span>
                      </h2>
                      {step.intro ? <p className="lead">{step.intro}</p> : null}
                    </div>
                    <div className={`brief-grid ${step.cards.length === 1 ? "one" : step.cards.length === 2 ? "two" : "three"}`}>
                      {step.cards.map((card) => (
                        <div className="card brief-card" key={card.key}>
                          <h3>{card.title}</h3>
                          <ul className="qlist">
                            {card.questions.map((q) => <li key={q}>{q}</li>)}
                          </ul>
                          <span className="resp-label">Sua resposta</span>
                          <textarea
                            className="answer"
                            value={String(answers[card.key] ?? "")}
                            onChange={(e) => setAnswer(card.key, e.target.value)}
                            placeholder="Escreva sua resposta aqui…"
                            rows={3}
                          />
                        </div>
                      ))}
                    </div>
                    {isLast ? (
                      <div className="cta-row" style={{ justifyContent: "center" }}>
                        <button className="btn solid" onClick={finishBriefing}>Concluir briefing →</button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <SubFoot
                  backTo={n === 1 ? "p-brief-cafe" : `p-brief-${n - 1}`}
                  backLabel={n === 1 ? "Pausa para o café" : "Anterior"}
                  right={isLast ? "Concluir →" : `${String(n + 1).padStart(2, "0")} · Próximo`}
                  onRight={() => scrollToId(isLast ? "p-hero" : `p-brief-${n + 1}`)}
                  cream
                  mid="north · briefing oficial"
                />
              </div>
            );
          })}
        </section>

        {/* ============ NÍVEL 03 · MARCA & PRODUTOS ============ */}
        <section className="row" id="sec-marca">
          <MenuPanel
            id="p-marca"
            label="Portal North · 03 / 04"
            eyebrow="Etapa 03 · Marca & Produtos"
            titleA="Sua marca, bem "
            titleB="organizada."
            lead="Centralize aqui a identidade visual e as imagens do dia a dia do seu negócio. É desse material que nascem os conteúdos do seu perfil."
            cta="Acessar as pastas"
            onCta={() => scrollToId("p-marca-1")}
            index="03 / 04"
            watermark="S"
          />

          <div className="panel" id="p-marca-1">
            <SubHead label="Marca & Produtos · Drive" backTo="p-marca" backLabel="Marca & Produtos" />
            <div className="p-body top">
              <SubTitle eyebrow="Pastas compartilhadas" titleA="Marca & " titleB="produtos" />
              <p className="lead" style={{ marginTop: 18, marginBottom: 36 }}>
                Suba e mantenha atualizado o material que alimenta os conteúdos. Tudo via Google Drive.
              </p>
              <div className="grid cols-3">
                {folders.map((f) => {
                  const url = links ? links[f.key] : null;
                  return (
                    <div className="card" key={f.key} style={{ minHeight: 360 }}>
                      <span className="folder" aria-hidden>
                        <svg viewBox="0 0 58 42" fill="none">
                          <path d="M2 8a4 4 0 0 1 4-4h14l6 6h22a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8Z" stroke="var(--teal)" strokeWidth="2" />
                        </svg>
                      </span>
                      <h3>{f.title}</h3>
                      <ul className="qlist">
                        {f.items.map((it) => <li key={it}>{it}</li>)}
                      </ul>
                      <div style={{ marginTop: "auto" }}>
                        {url ? (
                          <a className="btn" href={url} target="_blank" rel="noopener noreferrer">Abrir pasta no Drive ↗</a>
                        ) : (
                          <button className="btn" disabled>Pasta ainda não cadastrada</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <SubFoot backTo="p-marca" backLabel="Voltar" right="Marca & Produtos" mid="north · agência de marketing & tráfego" onRight={() => scrollToId("p-hero")} />
          </div>
        </section>

        {/* ============ NÍVEL 04 · RESULTADOS ============ */}
        <section className="row" id="sec-result">
          <MenuPanel
            id="p-result"
            label="Portal North · 04 / 04"
            eyebrow="Etapa 04 · Resultados"
            titleA="Resultados que "
            titleB="falam."
            lead="Acompanhe as métricas, leia os relatórios e registre seus feedbacks. É aqui que medimos o que está funcionando e ajustamos a rota juntos."
            cta="Ver resultados e métricas"
            onCta={() => scrollToId("p-result-1")}
            index="04 / 04"
            watermark="N"
          />

          <div className="panel scroll-page" id="p-result-1">
            <SubHead label="Resultados · Métricas" backTo="p-result" backLabel="Voltar ao menu" />
            <div className="p-body top">
              <SubTitle
                eyebrow="Acompanhamento"
                titleA="Resultados & "
                titleB="métricas"
                intro={metricsPending
                  ? "Em breve, os números reais da sua operação aparecem aqui — atualizados a cada ciclo."
                  : "Os números reais da sua operação, atualizados a cada ciclo."}
              />
              <div className="grid cols-4" style={{ marginTop: 28 }}>
                {metricSlots.map((m, i) => (
                  <div className={`card metric ${metricsPending ? "pending" : ""}`} key={`${m.label}-${i}`}>
                    <span className="val">{m.value}</span>
                    <span className="lbl">{m.label}</span>
                    {m.variation ? <span className="var">{m.variation}</span> : null}
                    {m.description ? <p style={{ fontSize: 13 }}>{m.description}</p> : null}
                  </div>
                ))}
              </div>

              <div className="split" style={{ marginTop: 40 }}>
                <div className="card block">
                  <span className="micro">Relatórios</span>
                  <h3>Acesse os resultados do mês</h3>
                  <p>Relatórios de desempenho, leitura das campanhas e próximos passos — atualizados a cada ciclo.</p>
                  {reportUrl ? (
                    <a className="btn" href={reportUrl} target="_blank" rel="noopener noreferrer">Abrir relatório mensal ↗</a>
                  ) : (
                    <button className="btn" disabled>Relatório ainda não publicado</button>
                  )}
                </div>
                <div className="card block">
                  <span className="micro">Seu feedback</span>
                  <h3>Como está sendo a parceria?</h3>
                  <p>Deixe aqui suas observações, elogios e pontos de ajuste — abrimos o formulário para você registrar.</p>
                  {feedbackUrl ? (
                    <a className="btn solid" href={feedbackUrl} target="_blank" rel="noopener noreferrer">Enviar feedback →</a>
                  ) : (
                    <button className="btn solid" disabled>Formulário em breve</button>
                  )}
                </div>
              </div>
            </div>
            <SubFoot backTo="p-result" backLabel="Voltar" right="Resultados" mid={name} onRight={() => scrollToId("p-hero")} />
          </div>
        </section>
      </div>
    </>
  );
}

/* ---------- shared pieces ---------- */

function MenuPanel(props: {
  id: string;
  label: string;
  eyebrow: string;
  titleA: string;
  titleB: string;
  line2?: string;
  lead: string;
  cta: string;
  onCta: () => void;
  index: string;
  watermark?: string;
}) {
  return (
    <div className="panel" id={props.id}>
      {props.watermark ? <span className="watermark" aria-hidden>{props.watermark}</span> : null}
      <div className="p-head">
        <span className="p-spacer" aria-hidden />
        <span className="p-label">{props.label}</span>
      </div>
      <div className="p-body">
        <p className="eyebrow">{props.eyebrow}</p>
        <h1 className="title">
          {props.titleA}
          <span className="accent">{props.titleB}</span>
          {props.line2 ? (
            <>
              <br />
              {props.line2}
            </>
          ) : null}
        </h1>
        <p className="lead">{props.lead}</p>
        <div className="cta-row">
          <button className="btn solid lg" onClick={props.onCta}>{props.cta} →</button>
        </div>
      </div>
      <div className="p-foot">
        <span>north · agência de marketing &amp; tráfego</span>
        <button className="foot-link top-link" onClick={() => scrollToId("p-hero")}>Retornar para o topo ↑</button>
        <span>{props.index}</span>
      </div>
    </div>
  );
}

function SubHead(props: { label: string; backTo: string; backLabel: string }) {
  return (
    <div className="p-head">
      <button className="backlink" onClick={() => scrollToId(props.backTo)}>← {props.backLabel}</button>
      <span className="p-label">{props.label}</span>
    </div>
  );
}

function SubTitle(props: { eyebrow: string; titleA: string; titleB: string; intro?: string }) {
  return (
    <div className="sub-title">
      <p className="eyebrow">{props.eyebrow}</p>
      <h2 className="title">
        {props.titleA}
        <span className="accent">{props.titleB}</span>
      </h2>
      {props.intro ? <p className="lead">{props.intro}</p> : null}
    </div>
  );
}

function SubFoot(props: {
  backTo: string;
  backLabel: string;
  right: string;
  onRight: () => void;
  mid?: string;
  cream?: boolean;
}) {
  return (
    <div className="p-foot">
      <button className="foot-link" onClick={() => scrollToId(props.backTo)}>← {props.backLabel}</button>
      <span className="mid">{props.mid ?? "north · agência de marketing & tráfego"}</span>
      <button className="foot-link" onClick={props.onRight}>{props.right} →</button>
    </div>
  );
}

function CoffeeCup() {
  return (
    <svg className="coffee" viewBox="0 0 280 240" fill="none" role="img" aria-label="Xícara de café">
      <defs>
        <linearGradient id="cupfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--teal)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--teal)" stopOpacity="0.04" />
        </linearGradient>
        <linearGradient id="brew" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--teal)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--teal-deep)" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      {/* steam */}
      <g stroke="var(--teal)" strokeWidth="3.5" strokeLinecap="round" opacity="0.7">
        <path d="M104 62 C95 48 113 40 104 24" />
        <path d="M132 66 C123 50 141 42 132 20" />
        <path d="M160 62 C151 48 169 40 160 26" />
      </g>
      {/* saucer */}
      <ellipse cx="130" cy="208" rx="94" ry="13" fill="none" stroke="var(--sand)" strokeWidth="3" opacity="0.5" />
      {/* handle */}
      <path d="M198 122 a36 36 0 0 1 0 60" stroke="var(--sand)" strokeWidth="7" fill="none" strokeLinecap="round" />
      {/* cup body */}
      <path d="M58 98 L58 150 A72 72 0 0 0 198 150 L198 98 Z" fill="url(#cupfill)" stroke="var(--sand)" strokeWidth="4.5" strokeLinejoin="round" />
      {/* coffee surface */}
      <ellipse cx="128" cy="98" rx="70" ry="15" fill="url(#brew)" stroke="var(--sand)" strokeWidth="4.5" />
      {/* highlight */}
      <path d="M92 96 a36 12 0 0 1 30 -8" stroke="var(--sand-soft)" strokeWidth="2.5" opacity="0.5" strokeLinecap="round" />
    </svg>
  );
}

type CompassPoint = { key: string; dir: string; dest: string; short: string; target: string; deg: number };
const COMPASS_POINTS: CompassPoint[] = [
  { key: "N", dir: "Norte", dest: "Resultados", short: "Resultados", target: "p-result", deg: 0 },
  { key: "L", dir: "Leste", dest: "Briefing", short: "Briefing", target: "p-briefing", deg: 90 },
  { key: "S", dir: "Sul", dest: "Marca & Produtos", short: "Marca", target: "p-marca", deg: 180 },
  { key: "O", dir: "Oeste", dest: "Manual do cliente", short: "Manual", target: "p-manual", deg: 270 },
];

const ringPos = (deg: number, r: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: Number((180 + Math.cos(a) * r).toFixed(2)), y: Number((180 + Math.sin(a) * r).toFixed(2)) };
};

function Compass({ onGo, onHover }: { onGo: (target: string) => void; onHover: (p: CompassPoint | null) => void }) {
  const [angle, setAngle] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [snapping, setSnapping] = useState(false);
  const ref = useRef<SVGSVGElement | null>(null);
  const raf = useRef(0);
  const angleRef = useRef(0);

  // Apply a target heading taking the shortest rotational path, so the same
  // (north) tip always tracks the cursor — no 180° flip when crossing an axis.
  const applyAngle = (target: number) => {
    const current = angleRef.current;
    const delta = ((target - current + 540) % 360) - 180;
    angleRef.current = current + delta;
    setAngle(angleRef.current);
  };

  const handleMove = (e: React.MouseEvent) => {
    if (snapping) return;
    const svg = ref.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const deg = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => applyAngle(deg));
  };

  const go = (p: CompassPoint) => {
    setSnapping(true);
    setActive(p.key);
    applyAngle(p.deg);
    onHover(null);
    window.setTimeout(() => {
      onGo(p.target);
      setSnapping(false);
    }, 320);
  };

  const minorTicks = Array.from({ length: 72 });

  return (
    <svg
      ref={ref}
      className="compass"
      viewBox="-28 -28 416 416"
      role="group"
      aria-label="Bússola de navegação"
      onMouseMove={handleMove}
      onMouseLeave={() => {
        if (!snapping) applyAngle(0);
        setActive(null);
        onHover(null);
      }}
    >
      <circle cx="180" cy="180" r="170" className="c-ring" />
      <circle cx="180" cy="180" r="120" className="c-ring c-faint" />
      {minorTicks.map((_, i) => {
        const a = (i * 5 * Math.PI) / 180;
        const long = i % 3 === 0;
        const inner = long ? 156 : 162;
        const x1 = Number((180 + Math.sin(a) * inner).toFixed(2));
        const y1 = Number((180 - Math.cos(a) * inner).toFixed(2));
        const x2 = Number((180 + Math.sin(a) * 170).toFixed(2));
        const y2 = Number((180 - Math.cos(a) * 170).toFixed(2));
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={`c-tick ${long ? "lg" : ""}`} />;
      })}

      {/* mouse-following needle */}
      <g
        className={`needle ${snapping ? "snap" : ""}`}
        style={{ transform: `rotate(${angle}deg)`, transformBox: "view-box", transformOrigin: "180px 180px" }}
      >
        <polygon points="180,44 185.5,180 174.5,180" className="needle-n" />
        <polygon points="180,316 185.5,180 174.5,180" className="needle-s" />
      </g>
      <circle cx="180" cy="180" r="6.5" className="c-hub" />

      {COMPASS_POINTS.map((p) => {
        const pos = ringPos(p.deg, 150);
        const lab = ringPos(p.deg, 196);
        const on = active === p.key;
        return (
          <g
            key={p.key}
            className={`compass-pt ${on ? "on" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`${p.dir} · ${p.dest}`}
            onMouseEnter={() => {
              if (snapping) return;
              setActive(p.key);
              applyAngle(p.deg);
              onHover(p);
            }}
            onClick={() => go(p)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") go(p);
            }}
          >
            <circle cx={pos.x} cy={pos.y} r="20" className="pt-hit" />
            <circle cx={pos.x} cy={pos.y} r={on ? 8 : 5} className="pt-dot" />
            <text x={lab.x} y={lab.y} className="pt-key" dominantBaseline="middle" textAnchor="middle">{p.key}</text>
          </g>
        );
      })}
    </svg>
  );
}
