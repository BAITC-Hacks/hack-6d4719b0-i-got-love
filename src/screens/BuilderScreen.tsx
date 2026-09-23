import TaskBuilder, { type TaskBuilderProps } from "../../task_builder/frontend/src/TaskBuilder";

export default function BuilderScreen(props: TaskBuilderProps) {
  return <TaskBuilder {...props} />;
}
