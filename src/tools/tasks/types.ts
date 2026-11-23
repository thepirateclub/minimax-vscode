export interface TaskLine {
  // The number of the line in the file.
  line: number;
  // The id of the task, it is the first word of the text when it looks like
  // an id, for example T-12 or 7.
  id: string;
  // The text of the task without its id.
  text: string;
  // The whole text of the line, the id lives in it.
  label: string;
  done: boolean;
  // The part of the line before the text, the bullet and the mark.
  prefix: string;
  raw: string;
}

export type TaskEdit =
  | { ok: true; content: string; message: string }
  | { ok: false; error: string };
