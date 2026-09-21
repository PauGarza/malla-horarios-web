# Estado del arte: asignación de horarios y profesores en universidades

*Documento de investigación preliminar — proyecto de malla horaria, ITAM*

## 1. Contexto y definición del problema

La construcción de horarios universitarios —conocida en la literatura como *University Course Timetabling Problem* (UCTP)— consiste en asignar cursos, grupos, profesores y aulas a bloques de tiempo específicos, cumpliendo un conjunto de restricciones duras (obligatorias) y blandas (deseables) [1]. Es un problema clásico de investigación de operaciones, catalogado como NP-difícil, lo que explica por qué sigue siendo objeto activo de investigación después de más de 60 años de estudio [2].

Dos variantes dominan la literatura:

- **Post-Enrollment Course Timetabling (PE-CTP):** los alumnos ya están inscritos a cursos específicos antes de construir el horario; el reto es evitar choques de horario entre las materias que cada alumno tomó [2].
- **Curriculum-Based Course Timetabling (CB-CTP):** en lugar de datos de inscripción individuales, se usa la malla curricular (currícula) de cada programa para inferir qué materias no deben chocar entre sí; es el enfoque más común en instituciones donde los grupos siguen una malla fija por semestre, como suele ocurrir en universidades latinoamericanas [2].

Cuando además se busca decidir **qué profesor imparte cada curso** (y no solo horario/aula), el problema se extiende a lo que algunos autores llaman *teacher/professor assignment* dentro del UCTP, incorporando restricciones de perfil académico, carga docente mínima/máxima y preferencias del profesor [3].

## 2. Enfoques de solución reportados en la literatura

### 2.1 Programación lineal/entera (exacta)

Es el enfoque más reportado en casos universitarios reales, sobre todo cuando la institución quiere una solución óptima (o cercana al óptimo) verificable matemáticamente, no solo "una solución factible".

- **Arratia-Martínez et al. (2021)** — *University Course Timetabling Problem with Professor Assignment*. Modelo de programación lineal entera aplicado a un departamento académico de una institución mexicana. Contempla profesores de tiempo completo (con número fijo de cursos según perfil) y de asignatura (con tope de cursos), matriz profesor-curso válida, y minimiza cursos sin profesor asignado y el desbalance de uso de horarios. Resuelto con branch-and-bound clásico y bajo esfuerzo computacional [3].
- **Mismos autores, trabajo posterior** — extiende el modelo para incorporar *preferencias de los profesores* y el *balance de carga docente* en instituciones con planta mayoritariamente de asignatura [4].
- **SciELO México (2024)** — *Un modelo de programación entera para la generación de horarios universitarios: un caso de estudio*. Modelo que asigna profesores a cursos según preferencia y disponibilidad, incorpora reglas de operación propias de la universidad, y separa restricciones duras (como restricciones) de las blandas (como parte de la función objetivo) [5].
- **Caso Ecuador (Escuela de Computación y Telecomunicaciones)** — modelo de programación lineal entera que resuelve simultáneamente asignación de aulas, profesores y horario en un único modelo matemático, buscando poder re-planificar rápido ante cambios de última hora (p. ej. renuncia de un profesor) [6].
- **Universidad de Concepción, Chile** — dos modelos de programación entera con distintas estrategias de solución (asignación directa a aulas vs. asignación a tipos de aula), con relajación de restricciones para resolver instancias grandes en tiempos razonables [7].
- **Universidad Politécnica Salesiana, Ecuador** — sistema experto que combina minería de datos con programación entera lineal para la asignación de materias, incorporando restricciones sobre cruces de horario para un mismo docente [8].

**Patrón común:** casi todos los casos de universidades reales (más que benchmarks académicos genéricos) usan programación lineal/entera porque el tamaño del problema por departamento es manejable, y porque permite justificar institucionalmente por qué se llegó a un horario específico (auditable, no una "caja negra").

### 2.2 Metaheurísticas

Cuando el problema crece (toda la universidad, no solo un departamento) o las restricciones son muy numerosas, la programación exacta se vuelve costosa computacionalmente, y se recurre a metaheurísticas: algoritmos genéticos, búsqueda tabú, recocido simulado (*simulated annealing*), *large neighbourhood search*, colonias de hormigas/abejas, GRASP, entre otras [9][10].

- Un survey reciente (2023) sobre UCTP resume que **búsqueda tabú** es de las metaheurísticas más usadas, y que aparece frecuentemente combinada con *constraint programming* [11].
- Otro survey (ScienceDirect, 2023) hace una revisión sistemática de enfoques metaheurísticos y propone una clasificación de métodos **híbridos** [10].
- Casos con algoritmos evolutivos y búsqueda tabú aplicados a horarios vespertinos universitarios también están documentados en la literatura en español [9].

**Trade-off documentado:** las metaheurísticas no garantizan optimalidad, pero escalan mejor a instituciones grandes y multi-departamento; la programación exacta da garantías pero puede volverse impráctica si el número de variables crece demasiado.

### 2.3 Programación por restricciones (Constraint Programming / CSP)

Modela el problema como un conjunto de variables con dominios y restricciones, en vez de una función objetivo lineal. Es particularmente flexible para agregar o quitar restricciones institucionales sin rehacer todo el modelo [12].

- Un estudio de 2023 aplicó un modelo CSP a un caso con 200 cursos, 45 profesores, 20 aulas y 20 bloques horarios, y reportó mejor desempeño que otros enfoques comparados en reducción de conflictos y factibilidad [13].
- Es el enfoque central del solver de **UniTime** (ver sección 3), que combina *constraint-based local search* con optimización [14].

### 2.4 Enfoques híbridos / matheurísticos

La tendencia más reciente (2023-2026) combina programación matemática con metaheurísticas ("matheurísticas"): usar el modelo exacto para subproblemas pequeños y una metaheurística para explorar el espacio de soluciones grande, o usar *Variable Neighbourhood Search* con vecindarios definidos por programación matemática [11][15]. Esto ha mejorado resultados en benchmarks históricos de high-school y university timetabling.

## 3. Software y sistemas ya existentes

### UniTime (open source)

**UniTime** es el sistema de código abierto más documentado y usado como referencia académica para timetabling universitario [14][16]. Puntos relevantes:

- Desarrollado originalmente de forma colaborativa entre varias universidades de Norteamérica y Europa; usado institucionalmente en producción (por ejemplo, en Purdue desde 2007) [17].
- Arquitectura distribuida: permite que distintos departamentos coordinen la construcción del horario sin un único punto centralizado de captura [14].
- El *solver* (llamado **CPSolver**) usa búsqueda local basada en restricciones (*constraint-based local search*), liberado bajo LGPL; la aplicación completa de timetabling está bajo GPL [14].
- Es la fuente de los datos reales usados en la **International Timetabling Competition 2019 (ITC 2019)**: se tomaron instancias de 10 universidades reales de distintas partes del mundo que usan UniTime en producción [18].
- Repositorio activo en GitHub (`UniTime/unitime`, `UniTime/cpsolver`), con actualizaciones recientes en 2026 [19].

Dado que UniTime es gratuito, de código abierto, y tiene datasets reales publicados, es un referente natural tanto como **posible solución a evaluar/adaptar** como fuente de **instancias de prueba** para validar cualquier modelo propio que se desarrolle en Autoplanear.

### Competencias internacionales de referencia (ITC)

La comunidad académica de timetabling ha organizado tres competencias internacionales que sirven como benchmark estándar para comparar algoritmos:

- **ITC-2002**
- **ITC-2007** (con pista específica de *Curriculum-Based Course Timetabling*, usando datos reales de la Universidad de Udine, Italia) [20]
- **ITC-2019** (la más reciente y compleja, con 30 instancias reales de universidades que usan UniTime, combinando *student sectioning* con asignación de horario y aula) [18][21]

Estas competencias son útiles como fuente de instancias de prueba estandarizadas si se quiere validar un modelo nuevo contra resultados publicados de otros investigadores.

## 4. Comparación de enfoques

| Enfoque | Ventaja principal | Limitación principal | Cuándo se usa en la literatura |
|---|---|---|---|
| Programación lineal/entera exacta | Solución óptima verificable, auditable | Escala mal si el problema crece mucho | Casos de un solo departamento/escuela, instituciones que necesitan justificar la asignación |
| Metaheurísticas (genéticos, tabú, SA, etc.) | Escala a instancias grandes y muchas restricciones | No garantiza optimalidad | Universidades completas, alta complejidad de restricciones |
| Constraint Programming / CSP | Muy flexible para agregar/quitar reglas institucionales | Puede requerir ajuste fino de heurísticas de búsqueda | Sistemas de producción de largo plazo (ej. UniTime) |
| Híbrido / matheurística | Combina garantías parciales con escalabilidad | Mayor complejidad de implementación | Investigación reciente, mejores resultados en benchmarks |

## 5. Puntos relevantes para el proyecto en ITAM

A partir de lo anterior, algunos elementos a considerar antes de definir el enfoque para Autoplanear:

1. **El caso más cercano al de ITAM ya existe publicado:** Arratia-Martínez et al. (2021) es un modelo hecho para una institución mexicana con estructura de profesores tiempo completo/asignatura — vale la pena leerlo a detalle como punto de partida, incluyendo sus restricciones exactas y su función objetivo [3][4].
2. **Definir primero si el problema es CB-CTP o PE-CTP** (es decir, si se va a planear con base en la malla curricular por semestre o con base en inscripciones reales de alumnos) determina buena parte del modelo [2].
3. **UniTime es una opción real a evaluar** antes de construir un solver propio desde cero: es gratuito, con solver ya probado en producción en universidades reales, y con datasets públicos para pruebas [14][18].
4. **La escala del problema determina el método:** si Autoplanear se va a limitar a un departamento (como el caso mexicano de referencia), programación entera puede ser suficiente y dar una solución óptima verificable. Si el alcance crece a toda la universidad, conviene considerar metaheurísticas o un híbrido desde el diseño.
5. **Separar restricciones duras de blandas desde el modelo de datos** (disponibilidad de profesor = dura; preferencia de horario = blanda) es el patrón consistente en todos los casos revisados, y facilita ajustar la función objetivo sin tocar las restricciones estructurales [5][8].

## Referencias

[1] M. Arratia-Martinez et al., "University Course Timetabling Problem with Professor Assignment," *Mathematical Problems in Engineering*, 2021. [Online]. Available: https://onlinelibrary.wiley.com/doi/10.1155/2021/6617177

[2] "Modelling and solving the university course timetabling problem with hybrid teaching considerations," *Journal of Scheduling*, Springer, 2024. [Online]. Available: https://link.springer.com/article/10.1007/s10951-024-00817-w

[3] M. Arratia-Martinez et al., "University Course Timetabling Problem with Professor Assignment," *ResearchGate*, 2021. [Online]. Available: https://www.researchgate.net/publication/348837423

[4] "Solution approaches to the course timetabling problem" / "Educational timetabling problem with teaching load assignment using preferences and compactness," *ResearchGate*. [Online]. Available: https://www.researchgate.net/publication/251326995

[5] "Un modelo de programación entera para la generación de horarios universitarios: Un caso de estudio," *SciELO México*, 2024. [Online]. Available: https://www.scielo.org.mx/scielo.php?script=sci_arttext&pid=S1405-55462024000100137

[6] "Formulación e implementación de un modelo de programación entera para la creación de horarios de clases: un caso de estudio en Ecuador," *Redalyc*. [Online]. Available: https://www.redalyc.org/journal/6079/607965937004/html/

[7] "Modelos de programación entera para un problema de programación de horarios para universidades," Universidad de Concepción, Chile, *ResearchGate*. [Online]. Available: https://www.researchgate.net/publication/28225182

[8] "Un sistema experto basado en minería de datos y programación entera lineal para soporte en la asignación de materias y diseño de horarios en educación superior," Universidad Politécnica Salesiana, *Redalyc*. [Online]. Available: https://www.redalyc.org/journal/5722/572261854010/html/

[9] "Asignación de horarios de clases universitarias mediante algoritmos evolutivos," *Academia.edu*. [Online]. Available: https://www.academia.edu/129569182/

[10] "Meta-heuristic approaches for the University Course Timetabling Problem," *ScienceDirect*, 2023. [Online]. Available: https://www.sciencedirect.com/science/article/pii/S2667305323000789

[11] "A survey of the state of the art of Educational Timetabling Problems," *ResearchGate*, 2026. [Online]. Available: https://www.researchgate.net/publication/399976040

[12] "A survey of approaches for university course timetabling problem," *ScienceDirect*, 2014. [Online]. Available: https://www.sciencedirect.com/science/article/abs/pii/S0360835214003714

[13] N. R. Joshi and T. V. Agarwal, "Optimizing University Course Timetabling Using Constraint Satisfaction Programming," 2023. [Online]. Available: https://iaiest.com/iaj/index.php/IAJSE/article/download/IAJSE1032/2342/2341

[14] "University Course Timetabling & Student Sectioning System," UniTime, ICAPS 2007. [Online]. Available: https://www.unitime.org/papers/icaps07.pdf

[15] "Decomposition, Reformulation, and Diving in University Course Timetabling," *arXiv*. [Online]. Available: https://arxiv.org/pdf/0903.1095

[16] "UniTime," Apereo Foundation. [Online]. Available: https://www.apereo.org/programs/software/unitime

[17] "UniTime," GitHub repository. [Online]. Available: https://github.com/UniTime/unitime

[18] "Real-world university course timetabling at the International Timetabling Competition 2019," UniTime. [Online]. Available: https://www.unitime.org/papers/patat22-itc2019.pdf

[19] "UniTime Project," GitHub organization. [Online]. Available: https://github.com/UniTime

[20] "The Second International Timetabling Competition (ITC-2007): Curriculum-based Course Timetabling (Track 3)," *ResearchGate*. [Online]. Available: https://www.researchgate.net/publication/215777351

[21] "The Third International Timetabling Competition," *ResearchGate*. [Online]. Available: https://www.researchgate.net/publication/257516108
