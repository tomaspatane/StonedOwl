(() => {
  const style = document.createElement('style');

  style.textContent = `
    .owl-insight-panel{border:1px solid #2d4338;border-radius:18px;background:#0b1511;margin:16px 0;padding:20px}
    .owl-insight-kicker{color:#baff64;letter-spacing:.14em;font-size:10px;font-weight:800;margin-bottom:9px}
    .owl-insight-headline{font-size:19px;line-height:1.35;font-weight:750;margin-bottom:14px}
    .owl-insight-grid{display:grid;grid-template-columns:1.25fr .75fr;gap:14px}
    .owl-insight-box{border:1px solid #213129;border-radius:13px;padding:14px;background:#09110f}
    .owl-insight-box h4{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:#8fa39a;margin:0 0 9px}
    .owl-story{padding:9px 0;border-bottom:1px solid #1b2a23;font-size:12px;line-height:1.4}
    .owl-story:last-child{border-bottom:0}
    .owl-story b{color:#baff64;margin-right:6px}
    .owl-actors{display:flex;flex-wrap:wrap;gap:7px}
    .owl-actor{border:1px solid #2b4035;border-radius:999px;padding:6px 9px;font-size:11px;color:#dce8e0}
    .owl-radar-insight{margin-top:16px;border-top:1px solid #213129;padding-top:14px}
    .owl-radar-insight strong{display:block;font-size:13px;line-height:1.4;margin-bottom:9px}
    .owl-signal{color:#8fa39a;font-size:11px;line-height:1.45;margin-top:5px}
    .owl-status-rising{color:#baff64}
    .owl-status-cooling{color:#8fc9ff}
    .owl-status-active{color:#f5d77d}
    .owl-status-coverage_changed{color:#f5d77d}
    .owl-status-unavailable{color:#ff9d9d}
    @media(max-width:700px){.owl-insight-grid{grid-template-columns:1fr}}
  `;

  document.head.appendChild(style);

  const liveView = document.getElementById('liveView');
  const metrics = liveView?.querySelector('.metrics');

  if (
    liveView &&
    metrics &&
    !document.getElementById('owlLiveInsight')
  ) {
    const panel = document.createElement('section');

    panel.id = 'owlLiveInsight';
    panel.className = 'owl-insight-panel';
    panel.hidden = true;

    metrics.before(panel);
  }

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function renderLive(interpretation) {
    const panel =
      document.getElementById('owlLiveInsight');

    if (!panel || !interpretation) {
      return;
    }

    const stories =
      Array.isArray(interpretation.stories)
        ? interpretation.stories
        : [];

    const actors =
      Array.isArray(interpretation.actors)
        ? interpretation.actors
        : [];

    const topSources =
      Array.isArray(interpretation.topSources)
        ? interpretation.topSources
        : [];

    panel.hidden = false;

    panel.innerHTML = `
      <div class="owl-insight-kicker">
        LECTURA STONEDOWL · MUESTRA RECUPERADA
      </div>

      <div class="owl-insight-headline">
        ${esc(
          interpretation.headline ||
          'Analizando la cobertura actual…'
        )}
      </div>

      <div class="owl-insight-grid">

        <div class="owl-insight-box">

          <h4>Historias que se repiten</h4>

          ${
            stories.length
              ? stories
                  .slice(0, 4)
                  .map(
                    story => `
                      <div class="owl-story">

                        <b>
                          ${Number(
                            story.articleCount || 0
                          )}×
                        </b>

                        ${esc(story.label)}

                        <div class="owl-signal">
                          ${Number(
                            story.sourceCount || 0
                          )}
                          medio${
                            Number(story.sourceCount || 0) === 1
                              ? ''
                              : 's'
                          }
                          distinto${
                            Number(story.sourceCount || 0) === 1
                              ? ''
                              : 's'
                          }.
                        </div>

                      </div>
                    `
                  )
                  .join('')
              : `
                <div class="owl-signal">
                  No aparece todavía una historia repetida
                  con suficiente fuerza en la muestra.
                </div>
              `
          }

        </div>

        <div class="owl-insight-box">

          <h4>
            Actores, entidades y concentración
          </h4>

          <div class="owl-actors">

            ${
              actors.length
                ? actors
                    .slice(0, 6)
                    .map(
                      actor => `
                        <span class="owl-actor">
                          ${esc(actor.name)}
                          ·
                          ${Number(actor.mentions || 0)}
                        </span>
                      `
                    )
                    .join('')
                : `
                  <span class="owl-signal">
                    Sin actores o entidades repetidas claras.
                  </span>
                `
            }

          </div>

          <div
            class="owl-signal"
            style="margin-top:12px"
          >
            Medio más presente:

            ${
              topSources[0]
                ? `${esc(topSources[0].source)}
                  (${Number(topSources[0].count || 0)})`
                : '—'
            }.
          </div>

          <div class="owl-signal">
            Concentración del principal medio:
            ${Number(
              interpretation.concentrationPercent || 0
            )}%.
          </div>

        </div>

      </div>
    `;
  }

  function renderRadar(data) {
    const monitors =
      Array.isArray(data?.monitors)
        ? data.monitors
        : [];

    if (!monitors.length) {
      return;
    }

    window.setTimeout(() => {
      const cards = [
        ...document.querySelectorAll(
          '#radarCards .monitor'
        )
      ];

      monitors.forEach(
        (monitor, index) => {
          const card =
            cards[index];

          const interpretation =
            monitor.interpretation;

          if (
            !card ||
            !interpretation
          ) {
            return;
          }

          let target =
            card.querySelector(
              '.owl-radar-insight'
            );

          if (!target) {
            target =
              document.createElement('div');

            target.className =
              'owl-radar-insight';

            card.appendChild(target);
          }

          const statusClass =
            `owl-status-${esc(
              interpretation.status ||
              'stable'
            )}`;

          const stories =
            Array.isArray(
              interpretation.stories
            )
              ? interpretation.stories
              : [];

          const actors =
            Array.isArray(
              interpretation.actors
            )
              ? interpretation.actors
              : [];

          const signals =
            Array.isArray(
              interpretation.signals
            )
              ? interpretation.signals
              : [];

          target.innerHTML = `

            <div class="owl-insight-kicker">
              QUÉ ESTÁ PASANDO · MUESTRA RECUPERADA
            </div>

            <strong class="${statusClass}">
              ${esc(
                interpretation.headline ||
                'Sin lectura disponible.'
              )}
            </strong>

            ${
              stories[0]
                ? `
                  <div class="owl-signal">

                    Historia dominante
                    en la muestra:

                    ${esc(
                      stories[0].label
                    )}

                    ·

                    ${Number(
                      stories[0]
                        .articleCount || 0
                    )}
                    resultados

                    ·

                    ${Number(
                      stories[0]
                        .sourceCount || 0
                    )}
                    medios.

                  </div>
                `
                : ''
            }

            ${
              actors.length
                ? `
                  <div class="owl-signal">

                    Actores/entidades repetidos:

                    ${actors
                      .slice(0, 4)
                      .map(
                        actor =>
                          esc(actor.name)
                      )
                      .join(', ')}.

                  </div>
                `
                : ''
            }

            ${signals
              .slice(0, 2)
              .map(
                signal => `
                  <div class="owl-signal">
                    ${esc(signal)}
                  </div>
                `
              )
              .join('')}

          `;
        }
      );
    }, 80);
  }

  const nativeFetch =
    window.fetch.bind(window);

  window.fetch =
    async (...args) => {
      const response =
        await nativeFetch(...args);

      try {
        const input =
          args[0];

        const url =
          typeof input === 'string'
            ? input
            : input?.url || '';

        if (
          url.includes('/api/news') ||
          url.includes('/api/gdelt')
        ) {
          response
            .clone()
            .json()
            .then(
              data =>
                renderLive(
                  data.interpretation
                )
            )
            .catch(() => {});
        }

        if (
          url.includes('/api/radar')
        ) {
          response
            .clone()
            .json()
            .then(renderRadar)
            .catch(() => {});
        }

      } catch {
        // La capa visual nunca debe romper la app base.
      }

      return response;
    };

  document
    .getElementById('radarTab')
    ?.addEventListener(
      'click',
      () => {
        window.setTimeout(
          async () => {
            try {
              const response =
                await nativeFetch(
                  '/api/radar',
                  {
                    headers: {
                      Accept:
                        'application/json'
                    }
                  }
                );

              if (response.ok) {
                renderRadar(
                  await response.json()
                );
              }

            } catch {
              // El Radar original sigue funcionando
              // aunque falle esta mejora visual.
            }
          },
          150
        );
      }
    );
})();
