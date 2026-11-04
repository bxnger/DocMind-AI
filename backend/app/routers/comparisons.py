from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.comparison import load_sentences, run_comparison
from app.deps import get_store
from app.errors import AppError
from app.store import Store

router = APIRouter(prefix="/comparisons", tags=["comparisons"])


class CreateComparison(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    document_a_id: str
    document_b_id: str


@router.post("", status_code=202)
def create_comparison(
    body: CreateComparison, background_tasks: BackgroundTasks, store: Store = Depends(get_store)
) -> dict:
    if body.document_a_id == body.document_b_id:
        raise AppError(422, "SAME_DOCUMENT", "Choose two different documents")
    for document_id in (body.document_a_id, body.document_b_id):
        if store.get(document_id)["status"] != "ready":
            raise AppError(409, "DOCUMENT_NOT_READY", "Document is still being processed")

    sentences_a = load_sentences(store, body.document_a_id)
    sentences_b = load_sentences(store, body.document_b_id)
    comparison = store.create_comparison(body.document_a_id, body.document_b_id)
    background_tasks.add_task(run_comparison, store, comparison["id"], sentences_a, sentences_b)
    return comparison


@router.get("/{comparison_id}")
def get_comparison(comparison_id: str, store: Store = Depends(get_store)) -> dict:
    return store.get_comparison(comparison_id)
