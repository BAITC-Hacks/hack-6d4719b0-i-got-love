export type ProposalDecision = "pending" | "selected" | "rejected";

export interface Team {
  id: number;
  name: string;
  interests: string[];
  skills: string[];
  technologies: string[];
  points: number;
}

export interface Proposal {
  id: number;
  task_id: number;
  team_id: number;
  idea: string;
  plan: string;
  duration: string;
  prototype_url: string;
  decision: ProposalDecision;
  progress_confirmed: boolean;
}

export type NewProposal = Pick<Proposal, "task_id" | "team_id" | "idea" | "plan" | "duration" | "prototype_url">;

export const PROGRESS_POINTS = 10;
