import { initialsOf } from "./initials";

// O avatar de uma pessoa, em qualquer tela.
//
// Uma regra só, em um lugar só: se existe foto, mostra a foto; se não existe,
// mostra as iniciais. Antes cada tela decidia isso por conta própria — e como
// a maioria só sabia renderizar iniciais, a foto que o usuário subia em
// Configurações simplesmente não aparecia em lugar nenhum além dali.
//
// A classe do círculo continua sendo de quem monta (`.admin-avatar`,
// `.tm-comment-av`, `.set-avatar-big`…), porque tamanho e cor são do contexto.
// O que este componente resolve é só a pergunta "foto ou iniciais?", que é a
// mesma em todo lugar.
export default function UserAvatar({
  name,
  photoUrl,
  className,
}: {
  /** Nome usado para as iniciais quando não há foto. */
  name: string | null | undefined;
  /** URL pública da foto (`profiles.avatar_url`). Ausente = cai nas iniciais. */
  photoUrl?: string | null;
  /** Classe do círculo, definida pela tela. */
  className?: string;
}) {
  return (
    <span className={className} aria-hidden>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL pública do
        // Storage em tamanho fixo; não há loader de otimização remota
        // configurado para esse host.
        <img src={photoUrl} alt="" className="avatar-photo" />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
