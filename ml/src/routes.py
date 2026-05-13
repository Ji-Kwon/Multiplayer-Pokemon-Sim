from fastapi import APIRouter
from pydantic import BaseModel
from typing import Literal

router = APIRouter(prefix="/ai")


class BattleStateSnapshot(BaseModel):
    battle_id: str
    format: Literal["singles", "doubles"]
    turn: int
    player_slot: int
    state: dict  # full snapshot — typed further when engine spec is finalized


class ActionChoice(BaseModel):
    action_type: Literal["move", "switch"]
    move_index: int | None = None
    switch_slot: int | None = None
    target_slot: int | None = None


@router.post("/choose-action", response_model=ActionChoice)
async def choose_action(snapshot: BattleStateSnapshot) -> ActionChoice:
    # Rule-based fallback: always use first move
    return ActionChoice(action_type="move", move_index=0)
