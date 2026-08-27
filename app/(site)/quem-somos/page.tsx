import type { Metadata } from "next";
import Link from "next/link";
import { listPublicTeamProfiles } from "@/lib/supabase";
import { initialsOf } from "../../avatar/initials";
export const metadata:Metadata={title:"Quem somos · North",description:"Conheça a visão, o método e os valores que orientam a North.",alternates:{canonical:"/quem-somos"},openGraph:{title:"Quem somos · North",description:"Marketing com direção, construído perto da realidade do negócio."}};
const values=[["01","Clareza","O cliente entende decisões, responsabilidades e próximos passos."],["02","Profundidade","A resposta nasce do contexto, não de uma fórmula copiada."],["03","Ritmo","Consistência vence a urgência fabricada e o improviso recorrente."],["04","Evidência","O que aprendemos com a operação orienta a próxima decisão."]];

// Sem isso o Next pré-renderiza a página no build (lê listPublicTeamProfiles
// uma vez e congela o resultado) — cargo/bio/foto editados depois em Minha
// conta só apareceriam aqui no próximo deploy.
export const dynamic = "force-dynamic";

export default async function QuemSomosPage(){
  // "Quem é público" é decidido só por ter cargo preenchido — ver
  // listPublicTeamProfiles (lib/supabase.ts) e a migration 20260827000000.
  // Continua funcionando com 0, 1, 2 ou qualquer número de perfis públicos;
  // não trava esperando "exatamente 3".
  const team = await listPublicTeamProfiles();
  return <><section className="inner-hero dark-section"><div className="site-wrap"><p className="eyebrow light">QUEM SOMOS</p><h1>Próximos da operação.<br/><em>Firmes na direção.</em></h1><p>A North nasceu para reduzir a distância entre a estratégia que parece boa e o trabalho que realmente precisa acontecer.</p></div></section><section className="site-section"><div className="site-wrap split-copy"><div><p className="eyebrow">NOSSA HISTÓRIA</p><h2>Uma bússola para<br/><em>decisões melhores.</em></h2></div><div><p>Negócios locais não precisam de mais volume sem contexto. Precisam entender onde estão, qual oportunidade vale perseguir e como transformar intenção em rotina.</p><p>Construímos a North em torno dessa ideia: estratégia próxima, produção cuidadosa, performance legível e uma operação compartilhada com o cliente.</p><p className="provisional">ANO, MARCOS E NÚMEROS DA HISTÓRIA PENDENTES DE VALIDAÇÃO INTERNA</p></div></div></section><section className="site-section offer-band"><div className="site-wrap"><div className="section-heading"><p className="eyebrow">O QUE NOS ORIENTA</p><h2>Princípios que aparecem<br/><em>no trabalho.</em></h2></div><div className="values-grid">{values.map(([n,t,d])=><article className="value-card" key={n}><small>{n}</small><h2>{t}</h2><p>{d}</p></article>)}</div></div></section><section className="site-section"><div className="site-wrap"><div className="section-heading"><p className="eyebrow">PESSOAS</p><h2>Quem conduz<br/><em>a operação.</em></h2>{team.length===0?<p>Nomes, cargos, biografias e retratos serão publicados após validação e autorização.</p>:null}</div><div className="team-grid">{team.map((p)=><article className="team-card" key={p.full_name}>{p.avatar_url?
  /* eslint-disable-next-line @next/next/no-img-element -- public storage URL, fixed decorative size, no remote-optimization loader configured for it */
  <img src={p.avatar_url} alt="" className="team-photo" />
  :<div className="placeholder-photo initials">{initialsOf(p.full_name)}</div>}<h2>{p.full_name}</h2><p>{p.cargo}</p>{p.bio?<p className="team-bio">{p.bio}</p>:null}</article>)}</div><div className="center"><Link href="/lp#diagnostico" className="site-btn solid">Conversar com a North</Link></div></div></section></>;
}
