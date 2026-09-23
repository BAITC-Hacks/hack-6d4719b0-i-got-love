import { Catalog } from "../../frontend/src/Catalog";

export default function CatalogScreen({ onRespond }: { onRespond: (taskId: number) => void }) {
  return <Catalog onRespond={onRespond} />;
}
