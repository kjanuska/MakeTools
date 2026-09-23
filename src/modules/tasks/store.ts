// Task files in memory: the shared table store with the task schema.
import { TableStore } from "../../lib/table/store";
import { EMPTY_TASK_CONTEXT, TASK_SCHEMA, type TaskContext } from "./schema";

export class TaskStore extends TableStore<TaskContext> {
  constructor() {
    super(TASK_SCHEMA, EMPTY_TASK_CONTEXT);
  }
}
