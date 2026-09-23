import { Catalog } from "../../frontend/src/Catalog";

type CatalogScreenProps = {
  onRespond: (taskId: number) => void;
  onCreate?: () => void;
  onEdit?: (taskId: number) => void;
};

export default function CatalogScreen({ onRespond, onEdit, onCreate }: CatalogScreenProps) {
  return <Catalog onRespond={onRespond} onEdit={onEdit} onCreate={onCreate} />;
}
