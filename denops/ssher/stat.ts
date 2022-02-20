export type StatType = {
  format: string;
  needEscape: boolean;
  flags: string;
};

export const statTypes = {
  access: { flags: "", format: "%A", needEscape: false },
  sizeInBytes: { flags: "", format: "%s", needEscape: false },
  userId: { flags: "", format: "%u", needEscape: false },
  userName: { flags: "", format: "%U", needEscape: true },
  groupId: { flags: "", format: "%g", needEscape: false },
  groupName: { flags: "", format: "%G", needEscape: true },
  fileName: { flags: "", format: "%n", needEscape: true },
};

export type StatTypeName = keyof typeof statTypes;
