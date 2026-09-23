import { Catalog, type RecommendationProfile } from "../../frontend/src/Catalog";

type CatalogScreenProps = {
  onRespond: (taskId: number) => void;
  onCreate?: () => void;
  currentUserId?: number;
  recommendationProfile?: RecommendationProfile;
  onEdit?: (taskId: number) => void;
};

export default function CatalogScreen({ onRespond, onEdit, onCreate, currentUserId, recommendationProfile }: CatalogScreenProps) {
  return <Catalog onRespond={onRespond} onEdit={onEdit} onCreate={onCreate} currentUserId={currentUserId} recommendationProfile={recommendationProfile} />;
}
