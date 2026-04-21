// Tag resolver for BLE events - resolves tagId to hostess information

import { findByTagId } from "@/lib/mock/tagRegistry";
import { TagStatus } from "@/lib/mock/tagRegistry";

export type ResolvedTag = {
  tagId: string;
  found: boolean;
  hostessName?: string;
  hostessId?: string;
  managerName?: string;
  storeKey?: string;
  assignedAt?: string;
  status?: TagStatus;
};

export function resolveTag(tagId: string): ResolvedTag {
  const trimmedTagId = tagId.trim();
  
  if (!trimmedTagId) {
    return { tagId: trimmedTagId, found: false };
  }
  
  const assignment = findByTagId(trimmedTagId);
  
  if (!assignment) {
    return { tagId: trimmedTagId, found: false };
  }
  
  // Only return found if status is ACTIVE
  if (assignment.status !== TagStatus.ACTIVE) {
    return { 
      tagId: trimmedTagId, 
      found: false,
      status: assignment.status
    };
  }
  
  return {
    tagId: trimmedTagId,
    found: true,
    hostessName: assignment.hostessName,
    hostessId: assignment.hostessId,
    managerName: assignment.managerName,
    storeKey: assignment.storeKey,
    assignedAt: assignment.assignedAt,
    status: assignment.status
  };
}
