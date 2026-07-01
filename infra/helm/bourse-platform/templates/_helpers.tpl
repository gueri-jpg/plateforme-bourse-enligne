{{/*
==============================================================================
_helpers.tpl — Fonctions de templating réutilisables dans tout le chart

Fournit :
  - bourse.fullname     : nom complet préfixé de chaque ressource K8s
  - bourse.name         : nom court du chart
  - bourse.chart        : nom + version du chart (label Helm standard)
  - bourse.labels       : labels communs (sélection + métadonnées Helm)
  - bourse.selectorLabels : labels de sélection (Deployment <-> Pod <-> Service)
==============================================================================
*/}}

{{/* Nom court du chart, tronqué à 63 caractères (limite Kubernetes) */}}
{{- define "bourse.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Nom complet utilisé comme préfixe pour toutes les ressources (Deployments,
Services, ConfigMaps, Secrets...). Combine le nom de release Helm et le nom
du chart, sauf si le nom de la release contient déjà le nom du chart.
*/}}
{{- define "bourse.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* Nom du chart + version, utilisé dans le label "helm.sh/chart" */}}
{{- define "bourse.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Labels communs appliqués à TOUTES les ressources du chart : permettent
l'identification (kubectl get all -l app.kubernetes.io/instance=...) et le
suivi du cycle de vie Helm (helm.sh/chart, app.kubernetes.io/managed-by).
*/}}
{{- define "bourse.labels" -}}
helm.sh/chart: {{ include "bourse.chart" . }}
{{ include "bourse.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/*
Labels de sélection : utilisés à la fois dans les Deployments (spec.selector
et template.metadata.labels) et les Services (spec.selector). Doivent rester
STABLES dans le temps (ne jamais les modifier après un premier déploiement,
sous peine d'erreur "selector is immutable").
*/}}
{{- define "bourse.selectorLabels" -}}
app.kubernetes.io/name: {{ include "bourse.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Construit l'URL complète d'une image Docker en préfixant avec le registre
ACR (global.imageRegistry) si celui-ci est défini. Usage :
  image: {{ include "bourse.image" (dict "registry" .Values.global.imageRegistry "repository" .Values.image.backend.repository "tag" .Values.image.backend.tag) }}
*/}}
{{- define "bourse.image" -}}
{{- if .registry -}}
{{- printf "%s/%s:%s" .registry .repository .tag -}}
{{- else -}}
{{- printf "%s:%s" .repository .tag -}}
{{- end -}}
{{- end -}}
