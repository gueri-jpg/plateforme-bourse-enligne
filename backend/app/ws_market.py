"""
WebSocket endpoint — flux temps réel des cotations BVC.

Consomme le topic Kafka "market.prices" dans un thread daemon et
diffuse chaque snapshot à tous les clients WebSocket connectés.

Endpoint : ws://<host>/ws/market

Variable d'environnement :
    KAFKA_BOOTSTRAP_SERVERS  (défaut : localhost:9092)
"""

import asyncio
import os
import sys
import threading
import uuid
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

_clients: set[WebSocket] = set()
_loop: asyncio.AbstractEventLoop | None = None
_latest_snapshot: str | None = None
_KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
# Unique consumer group per pod instance so every replica receives all partitions
_KAFKA_GROUP_ID = f"ws-market-{uuid.uuid4()}"


async def _broadcast(payload: str) -> None:
    global _latest_snapshot
    _latest_snapshot = payload
    dead: set[WebSocket] = set()
    for ws in _clients.copy():
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    _clients.difference_update(dead)


def _kafka_consumer_thread() -> None:
    try:
        from confluent_kafka import Consumer, KafkaError
    except ImportError:
        print(
            "[ws_market] confluent-kafka non installé — WebSocket market inactif.",
            file=sys.stderr,
        )
        return

    consumer = Consumer(
        {
            "bootstrap.servers": _KAFKA_BOOTSTRAP,
            "group.id": _KAFKA_GROUP_ID,
            "auto.offset.reset": "latest",
            "enable.auto.commit": False,
        }
    )
    consumer.subscribe(["market.prices"])
    print(
        f"[ws_market] Consumer Kafka démarré "
        f"(broker={_KAFKA_BOOTSTRAP}, topic=market.prices)"
    )

    while True:
        msg = consumer.poll(1.0)
        if msg is None:
            continue
        if msg.error():
            if msg.error().code() != KafkaError._PARTITION_EOF:
                print(f"[ws_market] Erreur Kafka : {msg.error()}")
            continue
        payload = msg.value().decode("utf-8")
        global _latest_snapshot
        _latest_snapshot = payload  # cache even before first WebSocket client connects
        if _loop and not _loop.is_closed():
            asyncio.run_coroutine_threadsafe(_broadcast(payload), _loop)


def start_kafka_thread() -> None:
    t = threading.Thread(
        target=_kafka_consumer_thread,
        daemon=True,
        name="kafka-ws-consumer",
    )
    t.start()


@router.websocket("/ws/market")
async def ws_market(websocket: WebSocket) -> None:
    global _loop
    _loop = asyncio.get_event_loop()
    await websocket.accept()
    _clients.add(websocket)
    print(f"[ws_market] Client connecté ({len(_clients)} connecté(s))")

    if _latest_snapshot:
        await websocket.send_text(_latest_snapshot)

    try:
        while True:
            # receive_text() bloque jusqu'au prochain message du client
            # (ping navigateur, commande future) ou jusqu'à la déconnexion.
            # C'est ce qui maintient la connexion WebSocket vivante côté serveur.
            await websocket.receive_text()
    except WebSocketDisconnect:
        _clients.discard(websocket)
        print(f"[ws_market] Client déconnecté ({len(_clients)} restant(s))")