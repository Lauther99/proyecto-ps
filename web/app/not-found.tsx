import { Pagina } from "@/components/marco";
import { Enlace, Mensaje } from "@/components/ui";
import { T } from "@/data/textos";

export default function NoLista() {
  return (
    <Pagina requiere={[]}>
      <Mensaje titulo={T.comun.noListaTitulo} texto={T.comun.noListaTexto}>
        <Enlace href="/">{T.comun.volverInicio}</Enlace>
      </Mensaje>
    </Pagina>
  );
}
