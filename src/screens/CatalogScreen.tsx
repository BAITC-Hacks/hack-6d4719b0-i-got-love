import { Catalog } from "../../frontend/src/Catalog";

type CatalogScreenProps = {
  onRespond: (taskId: number) => void;
  onEdit?: (taskId: number) => void;
};

export default function CatalogScreen({ onRespond, onEdit }: CatalogScreenProps) {
  return <Catalog onRespond={onRespond} onEdit={onEdit} />;
}
